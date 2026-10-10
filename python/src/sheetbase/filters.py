"""Filter trees → Ibis boolean expressions with Sheetbase semantics.

The reference is ``buildPredicate`` in ``packages/shared/src/predicate.ts``;
``packages/studio/src/lib/sql-compile.ts`` is the DuckDB twin of this module.
Both are pinned by ``packages/studio/fixtures/filter-parity.json``.

Rules, in brief:

* AND = every child, OR = any child, NOT = *no* child (NOR). An empty AND or
  NOT matches everything; an empty OR matches nothing.
* ``eq``/``neq``/``in`` are "loose": booleans match true/yes/1 text, numbers
  match numeric text (``"1,200"`` equals ``1200``), date-shaped text matches by
  instant, anything else compares as case-insensitive text. ``eq ""`` matches
  nulls; ``neq`` keeps nulls.
* ``gt``/``gte``/``lt``/``lte``/``between`` compare numbers with numbers and
  dates with dates; a kind mismatch never matches.
* Every condition is null-free, so ``NOT`` can't be flipped by a NULL.

The dispatch reads each column's Ibis type and the expected value's Python
type at compile time — the same choice ``looseEqual`` makes per row.
Date-only strings parse as UTC midnight; a datetime string without an offset
is read as UTC (the browser would use its local zone).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

import ibis
import ibis.expr.types as ir

__all__ = ["compile_filter", "apply_view", "field_kind", "UnsupportedFilter"]


class UnsupportedFilter(ValueError):
    """An operator this executor can't evaluate — never silently ignored."""


# --- JS value classification (asNum / asDate / asComparable) ----------------

_JS_NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
_JS_RADIX = re.compile(r"^0([xXoObB])([0-9a-fA-F]+)$")


def _js_number(text: str) -> float | None:
    """``Number(text)`` for the forms that matter (decimal, exponent, 0x/0o/0b)."""
    stripped = text.strip()
    if stripped == "":
        return None
    match = _JS_RADIX.match(stripped)
    if match:
        base = {"x": 16, "o": 8, "b": 2}[match.group(1).lower()]
        try:
            return float(int(match.group(2), base))
        except ValueError:
            return None
    if not _JS_NUMBER.match(stripped):
        return None
    value = float(stripped)
    return value if math.isfinite(value) else None


def as_num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str) and value.strip() != "":
        return _js_number(value.replace(",", ""))
    return None


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


_DATE_ONLY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_DATETIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$"
)


def as_date_ms(value: Any) -> int | None:
    """``asDate``: epoch milliseconds for date-shaped values, else None."""
    if isinstance(value, datetime):
        stamp = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(stamp.timestamp() * 1000)
    if isinstance(value, date):
        return int(datetime(value.year, value.month, value.day, tzinfo=timezone.utc).timestamp() * 1000)
    text = as_text(value).strip()
    if not re.search(r"[-/:]", text) or not re.search(r"\d{4}", text):
        return None
    match = _DATE_ONLY.match(text)
    if match:
        try:
            parsed = datetime(int(match[1]), int(match[2]), int(match[3]), tzinfo=timezone.utc)
        except ValueError:
            return None
        return int(parsed.timestamp() * 1000)
    match = _ISO_DATETIME.match(text)
    if match:
        year, month, day, hour, minute = (int(match[i]) for i in range(1, 6))
        second = int(match[6] or 0)
        fraction = (match[7] or "0").ljust(3, "0")[:3]
        zone = match[8]
        tz = timezone.utc
        if zone and zone != "Z":
            sign = 1 if zone[0] == "+" else -1
            digits = zone[1:].replace(":", "")
            tz = timezone(sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:])))
        try:
            parsed = datetime(year, month, day, hour, minute, second, int(fraction) * 1000, tzinfo=tz)
        except ValueError:
            return None
        return int(parsed.timestamp() * 1000)
    for fmt in ("%Y/%m/%d", "%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S"):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)
        except ValueError:
            continue
    return None


@dataclass(frozen=True)
class Comparable:
    kind: str  # "num" | "date"
    value: float


def as_comparable(value: Any) -> Comparable | None:
    number = as_num(value)
    if number is not None:
        return Comparable("num", number)
    stamp = as_date_ms(value)
    return None if stamp is None else Comparable("date", stamp)


def between_bounds(value: Any) -> tuple[Comparable, Comparable] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        low_raw, high_raw = value[0], value[1]
    elif isinstance(value, Mapping) and "low" in value and "high" in value:
        low_raw, high_raw = value["low"], value["high"]
    else:
        return None
    low, high = as_comparable(low_raw), as_comparable(high_raw)
    if low is None or high is None or low.kind != high.kind:
        return None
    return low, high


# --- Column expressions -----------------------------------------------------


def field_kind(column: ir.Value) -> str:
    """Sheetbase field type for an Ibis column: number, boolean, date, datetime or text."""
    dtype = column.type()
    if dtype.is_boolean():
        return "boolean"
    if dtype.is_numeric():
        return "number"
    if dtype.is_date():
        return "date"
    if dtype.is_timestamp():
        return "datetime"
    return "text"


@dataclass
class _Column:
    expr: ir.Value
    kind: str


def _column(table: ir.Table, field: str) -> _Column:
    names = list(table.columns)
    name = field if field in names else next((n for n in names if n.lower() == field.lower()), None)
    if name is None:
        return _Column(ibis.literal(None, type="string"), "text")
    column = table[name]
    return _Column(column, field_kind(column))


def _ms_digits(ts: ir.TimestampValue) -> ir.StringValue:
    return ts.millisecond().cast("string").lpad(3, "0")


def text_expr(col: _Column) -> ir.StringValue:
    """The value as the JS row holds it, rendered to text (``asText``)."""
    c = col.expr
    if col.kind == "number":
        value = c.cast("float64")
        as_int = ibis.cases(
            ((value == value.floor()) & (value.abs() < 1e15), value.cast("int64").cast("string")),
            else_=value.cast("string"),
        )
        return as_int.fill_null("")
    if col.kind == "boolean":
        return ibis.cases((c, "true"), (~c, "false"), else_="").cast("string")
    if col.kind == "date":
        return c.cast("date").strftime("%Y-%m-%d").fill_null("")
    if col.kind == "datetime":
        ts = c.cast("timestamp")
        return (ts.strftime("%Y-%m-%dT%H:%M:%S") + "." + _ms_digits(ts) + "Z").fill_null("")
    return c.cast("string").fill_null("")


def _text_as_number(col: _Column) -> ir.FloatingValue:
    return col.expr.cast("string").replace(",", "").strip().nullif("").try_cast("float64")


def _text_as_timestamp(col: _Column) -> ir.TimestampValue:
    text = col.expr.cast("string").strip()
    shaped = text.re_search(r"[-/:]") & text.re_search(r"\d{4}")
    return ibis.cases((shaped, text.try_cast("timestamp")), else_=ibis.null("timestamp"))


def _timestamp_literal(ms: float) -> ir.TimestampScalar:
    instant = datetime(1970, 1, 1) + timedelta(milliseconds=ms)
    return ibis.timestamp(instant)


def _null_free(expr: ir.BooleanValue) -> ir.BooleanValue:
    return expr.fill_null(False)


def _text_eq(col: _Column, expected: Any) -> ir.BooleanValue:
    return text_expr(col).lower() == as_text(expected).lower()


def _eq(col: _Column, expected: Any) -> ir.BooleanValue:
    if isinstance(expected, bool):
        if col.kind == "boolean":
            return _null_free(col.expr == ibis.literal(expected))
        return text_expr(col).lower().isin(["true", "yes", "1"] if expected else ["false", "no", "0"])
    expected_num = as_num(expected)
    expected_ms = as_date_ms(expected)
    numeric_arm = expected_num is not None and as_text(expected).strip() != ""
    if col.kind == "number":
        return _null_free(col.expr.cast("float64") == expected_num) if numeric_arm else _text_eq(col, expected)
    if col.kind in ("date", "datetime"):
        if expected_ms is None:
            return _text_eq(col, expected)
        return _null_free(col.expr.cast("timestamp") == _timestamp_literal(expected_ms))
    if col.kind == "boolean":
        return _text_eq(col, expected)
    as_number = _text_as_number(col)
    as_ts = _text_as_timestamp(col)

    def fallthrough() -> ir.BooleanValue:
        if expected_ms is None:
            return _text_eq(col, expected)
        return ibis.cases((as_ts.notnull(), as_ts == _timestamp_literal(expected_ms)), else_=_text_eq(col, expected))

    if numeric_arm:
        return ibis.cases((as_number.notnull(), as_number == expected_num), else_=fallthrough())
    return fallthrough()


_OPS = {">": "__gt__", ">=": "__ge__", "<": "__lt__", "<=": "__le__"}


def _compare(col: _Column, op: str, bound: Comparable) -> ir.BooleanValue:
    method = _OPS[op]
    if col.kind == "number":
        return _null_free(getattr(col.expr.cast("float64"), method)(bound.value)) if bound.kind == "num" else ibis.literal(False)
    if col.kind in ("date", "datetime"):
        if bound.kind != "date":
            return ibis.literal(False)
        return _null_free(getattr(col.expr.cast("timestamp"), method)(_timestamp_literal(bound.value)))
    if col.kind == "boolean":
        return ibis.literal(False)
    as_number = _text_as_number(col)
    if bound.kind == "num":
        return _null_free(getattr(as_number, method)(bound.value))
    as_ts = _text_as_timestamp(col)
    return _null_free(ibis.cases((as_number.isnull(), getattr(as_ts, method)(_timestamp_literal(bound.value))), else_=ibis.null("boolean")))


def _blank(col: _Column) -> ir.BooleanValue:
    if col.kind in ("number", "boolean", "date", "datetime"):
        return col.expr.isnull()
    return col.expr.isnull() | (col.expr.cast("string").strip() == "")


def _iso_day(ms: float) -> str:
    return (datetime(1970, 1, 1) + timedelta(milliseconds=ms)).strftime("%Y-%m-%d")


def _condition(col: _Column, operator: str, value: Any, now_ms: float) -> ir.BooleanValue:
    if operator == "isNull":
        return _blank(col)
    if operator == "notNull":
        return ~_blank(col)
    if operator == "eq":
        return _eq(col, value)
    if operator == "neq":
        return ~_eq(col, value)
    if operator in ("contains", "startsWith", "endsWith"):
        haystack = text_expr(col).lower()
        needle = as_text(value).lower()
        if operator == "contains":
            return haystack.contains(needle)
        if operator == "startsWith":
            return haystack.startswith(needle)
        return haystack.endswith(needle)
    if operator == "in":
        if not isinstance(value, (list, tuple)) or not value:
            return ibis.literal(False)
        result = _eq(col, value[0])
        for item in value[1:]:
            result = result | _eq(col, item)
        return result
    if operator == "between":
        bounds = between_bounds(value)
        if bounds is None:
            return ibis.literal(False)
        low_value = min(bounds[0].value, bounds[1].value)
        high_value = max(bounds[0].value, bounds[1].value)
        kind = bounds[0].kind
        return _compare(col, ">=", Comparable(kind, low_value)) & _compare(col, "<=", Comparable(kind, high_value))
    if operator in ("gt", "gte", "lt", "lte"):
        bound = as_comparable(value)
        if bound is None:
            return ibis.literal(False)
        return _compare(col, {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[operator], bound)
    if operator == "withinLastDays":
        days = as_num(value)
        if days is None or days <= 0:
            return ibis.literal(False)
        today = _iso_day(now_ms)
        start = _iso_day(now_ms - (days - 1) * 86_400_000)
        if col.kind in ("date", "datetime"):
            day = col.expr.cast("timestamp").strftime("%Y-%m-%d")
        elif col.kind == "text":
            day = _text_as_timestamp(col).strftime("%Y-%m-%d")
        else:
            return ibis.literal(False)
        return _null_free((day >= start) & (day <= today))
    raise UnsupportedFilter(f"Unsupported filter operator: {operator}")


def _now_ms(now: datetime | None) -> float:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.timestamp() * 1000


def compile_filter(node: Mapping[str, Any] | None, table: ir.Table, *, now: datetime | None = None) -> ir.BooleanValue | None:
    """Compile a filter tree (plain JSON) against ``table``. None means "every row"."""
    if not node:
        return None
    now_ms = _now_ms(now)

    def walk(current: Mapping[str, Any]) -> ir.BooleanValue:
        if current.get("type") == "condition":
            return _condition(_column(table, str(current.get("field", ""))), str(current.get("operator")), current.get("value"), now_ms)
        children = [walk(child) for child in current.get("children", [])]
        combinator = current.get("combinator", "AND")
        if combinator == "OR":
            if not children:
                return ibis.literal(False)
            result = children[0]
            for child in children[1:]:
                result = result | child
            return result
        if combinator == "NOT":
            if not children:
                return ibis.literal(True)
            result = children[0]
            for child in children[1:]:
                result = result | child
            return ~result
        if not children:
            return ibis.literal(True)
        result = children[0]
        for child in children[1:]:
            result = result & child
        return result

    return walk(node)


def apply_view(table: ir.Table, view: Mapping[str, Any], *, now: datetime | None = None) -> ir.Table:
    """Apply a Studio view (filter, sort, limit) to an Ibis table — exact semantics."""
    predicate = compile_filter(view.get("filter"), table, now=now)
    result = table.filter(predicate) if predicate is not None else table
    sort = view.get("sort")
    if sort and sort.get("field") in result.columns:
        key = result[sort["field"]]
        result = result.order_by(ibis.desc(key) if sort.get("direction") == "desc" else key)
    if view.get("limit"):
        result = result.limit(int(view["limit"]))
    return result
