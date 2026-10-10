"""The Studio backend: every Studio operation, executed by Ibis where the data lives.

One ``StudioBackend`` holds a catalog of tables — pandas/polars/pyarrow data
(loaded into a private in-memory DuckDB) or Ibis tables on any backend
(Postgres, Snowflake, BigQuery, DuckDB files, …) — and answers the Studio wire
contract (see ``packages/studio/src/sources/http.ts``). The HTTP server and
the notebook widget both call it.

Read-only by construction: user SQL must be a single SELECT/WITH query over
catalogued tables (checked with sqlglot before it runs), the private DuckDB
has external file/network access switched off once data is loaded, and
nothing writes back.
"""

from __future__ import annotations

import io
import json
import math
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping

import ibis
import ibis.expr.types as ir
import sqlglot
import sqlglot.expressions as sge

from .filters import compile_filter, field_kind, text_expr

__all__ = ["StudioBackend", "StudioError", "Table"]

PAGE_MAX = 5_000
SAMPLE_MAX = 100_000
PROFILE_FIELD_MAX = 200
SUMMARIES = {"mean", "median", "sum", "min", "max", "count"}
# Table functions that reach outside the catalog (files, URLs, other databases).
BLOCKED_FUNCTIONS = re.compile(
    r"^(read_|scan_|glob$|sniff_csv$|parquet_|iceberg_|delta_scan$|postgres_|mysql_|sqlite_|attach$|query_table$|query$)",
    re.IGNORECASE,
)


class StudioError(ValueError):
    """A request the backend refuses; ``status`` is the HTTP status to report."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class Table:
    id: str
    label: str
    expr: ir.Table
    kind: str = "table"
    sql: str | None = None
    description: str | None = None
    row_count: int | None = None
    # True when `id` names a real relation SQL can reference on `expr`'s backend.
    sql_name: bool = False
    _fields: list[dict[str, Any]] | None = field(default=None, repr=False)

    def fields(self) -> list[dict[str, Any]]:
        if self._fields is None:
            schema = self.expr.schema()
            self._fields = [
                {
                    "id": name,
                    "label": name,
                    "dataType": field_kind(self.expr[name]),
                    "nullable": bool(dtype.nullable),
                }
                for name, dtype in schema.items()
            ]
        return self._fields

    def info(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "rowCount": self.row_count,
            "fields": self.fields(),
            "kind": self.kind,
        }
        if self.sql:
            out["sql"] = self.sql
        if self.description:
            out["description"] = self.description
        return out


# --- JSON-safe values (what the browser's rows look like) --------------------


def _iso_datetime(value: datetime) -> str:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def to_json_value(value: Any, kind: str | None = None) -> Any:
    """Plain JSON for one cell: ISO dates, finite floats, None for missing."""
    if value is None:
        return None
    try:
        import pandas as pd

        if value is pd.NaT or (not isinstance(value, (str, bytes, list, dict, tuple)) and pd.isna(value)):
            return None
        if isinstance(value, pd.Timestamp):
            value = value.to_pydatetime()
    except (ImportError, TypeError, ValueError):
        pass
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            value = value.item()
        except (AttributeError, ValueError):
            pass
    if isinstance(value, bool):
        return value
    if isinstance(value, datetime):
        if kind == "date":
            return value.strftime("%Y-%m-%d")
        return _iso_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple, dict)):
        return json.loads(json.dumps(value, default=str))
    return str(value) if not isinstance(value, str) else value


def _records(frame, kinds: Mapping[str, str]) -> list[dict[str, Any]]:
    columns = list(frame.columns)
    return [
        {name: to_json_value(value, kinds.get(name)) for name, value in zip(columns, row)}
        for row in frame.itertuples(index=False, name=None)
    ]


def _effective_filter(params: Mapping[str, Any]) -> Mapping[str, Any] | None:
    tree = params.get("filterTree")
    if tree:
        return tree
    flat = params.get("filters") or []
    if not flat:
        return None
    return {
        "type": "group",
        "combinator": "OR" if params.get("filterLogic") == "or" else "AND",
        "children": [
            {"type": "condition", "field": clause.get("fieldId"), "operator": clause.get("operator"), "value": clause.get("value")}
            for clause in flat
        ],
    }


def _bin_edges(low: float, high: float, bins: int) -> tuple[list[float], float]:
    if high <= low:
        return [low - 0.5, low + 0.5], 1.0
    width = (high - low) / bins
    return [high if index == bins else low + index * width for index in range(bins + 1)], width


def _epoch_ms(column: ir.Value) -> ir.NumericValue:
    ts = column.cast("timestamp")
    return ts.epoch_seconds().cast("int64") * 1000 + ts.millisecond()


def _slug(name: str, taken: Iterable[str]) -> str:
    stem = re.sub(r"\.[^.]+$", "", name).lower()
    stem = re.sub(r"[^a-z0-9]+", "_", stem).strip("_") or "table"
    base = stem if re.match(r"^[a-z_]", stem) else f"t_{stem}"
    taken = set(taken)
    candidate, index = base, 2
    while candidate in taken:
        candidate = f"{base}_{index}"
        index += 1
    return candidate


class StudioBackend:
    """Tables plus the Studio operations over them.

    >>> backend = StudioBackend({"runs": df})                 # pandas
    >>> backend.add("orders", con.table("orders"))            # any Ibis table
    """

    def __init__(
        self,
        tables: Mapping[str, Any] | None = None,
        *,
        label: str = "Python",
        allow_sql: bool = True,
        allow_upload: bool = True,
        sample_seed: int = 42,
    ):
        self.label = label
        self.allow_sql = allow_sql
        self.allow_upload = allow_upload
        self.sample_seed = sample_seed
        self._tables: dict[str, Table] = {}
        self._con = ibis.duckdb.connect()
        self._lock = threading.RLock()
        self._queries = 0
        # Data reaches this connection as Python objects (replacement scans),
        # never through SQL file or network access — so switch that off.
        self._con.raw_sql("SET enable_external_access = false")
        for name, data in (tables or {}).items():
            self.add(name, data)

    # --- catalog -----------------------------------------------------------

    def add(self, name: str, data: Any, *, label: str | None = None, description: str | None = None) -> dict[str, Any]:
        """Register a table: pandas/polars/pyarrow data, a file path, or an Ibis table."""
        with self._lock:
            # Re-adding an existing table name replaces it; anything else gets a
            # unique SQL-friendly id derived from the name.
            table_id = name if name in self._tables else _slug(name, self._tables)
            if isinstance(data, ir.Table):
                expr, sql_name = data, False
                try:
                    sql_name = data.get_name() == table_id
                except Exception:  # noqa: BLE001 — expressions have no name
                    sql_name = False
            else:
                if isinstance(data, (str, Path)):
                    data = _read_path(Path(data))
                expr = self._load(table_id, data)
                sql_name = True
            entry = Table(id=table_id, label=label or name, expr=expr, description=description, sql_name=sql_name)
            # Local data is counted now (cheap). Tables on other backends are
            # counted on first use, so connecting to a warehouse stays fast;
            # until then the Studio keeps them at the source.
            if not isinstance(data, ir.Table):
                entry.row_count = int(expr.count().execute())
            self._tables[table_id] = entry
            return entry.info()

    def _load(self, table_id: str, data: Any) -> ir.Table:
        return self._con.create_table(table_id, data, overwrite=True)

    def table(self, table_id: str) -> Table:
        entry = self._tables.get(table_id)
        if entry is None:
            raise StudioError(f"Unknown table: {table_id}", 404)
        if entry.row_count is None:
            entry.row_count = int(entry.expr.count().execute())
        return entry

    def catalog(self) -> dict[str, Any]:
        with self._lock:
            return {
                "source": {"id": "python", "label": self.label, "kind": "python"},
                "capabilities": {
                    "sql": self.allow_sql,
                    "sqlDialect": "duckdb",
                    "profile": True,
                    "histogram": True,
                    "sample": True,
                    "upload": self.allow_upload,
                },
                "tables": [entry.info() for entry in self._tables.values()],
            }

    # --- helpers -------------------------------------------------------------

    def _filtered(self, entry: Table, tree: Mapping[str, Any] | None) -> ir.Table:
        predicate = compile_filter(tree, entry.expr)
        return entry.expr.filter(predicate) if predicate is not None else entry.expr

    def _kinds(self, entry: Table) -> dict[str, str]:
        return {f["id"]: f["dataType"] for f in entry.fields()}

    def _fields(self, entry: Table, ids: Iterable[str] | None) -> list[str]:
        known = [f["id"] for f in entry.fields()]
        wanted = [i for i in (ids or []) if i in known]
        return wanted or known

    def _project(self, expr: ir.Table, names: list[str], kinds: Mapping[str, str]) -> ir.Table:
        columns = {}
        for name in names:
            kind = kinds.get(name, "text")
            column = expr[name]
            if kind == "number":
                columns[name] = column.cast("float64")
            elif kind == "text":
                columns[name] = column.cast("string")
            else:
                columns[name] = column
        return expr.select(**columns)

    # --- operations ----------------------------------------------------------

    def page(self, params: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            entry = self.table(str(params.get("datasetId", "")))
            kinds = self._kinds(entry)
            expr = self._filtered(entry, _effective_filter(params))
            start = max(0, int(params.get("rowStart", 0)))
            count = min(PAGE_MAX, max(0, int(params.get("rowCount", 200))))
            names = self._fields(entry, params.get("fieldIds"))
            ordered = expr
            keys = []
            for clause in params.get("sort") or []:
                name = clause.get("fieldId")
                if name in kinds:
                    column = ordered[name]
                    nulls_first = clause.get("nulls") == "first"
                    keys.append(ibis.desc(column, nulls_first=nulls_first) if clause.get("direction") == "desc" else ibis.asc(column, nulls_first=nulls_first))
            if keys:
                ordered = ordered.order_by(keys)
            total = int(expr.count().execute())
            frame = self._project(ordered, names, kinds).limit(count, offset=start).execute() if count else None
            records = _records(frame, kinds) if frame is not None else []
            return {
                "request": {"datasetId": entry.id, "rowStart": start, "rowCount": count, "fieldIds": names},
                "records": [{"recordId": str(start + index), "values": values} for index, values in enumerate(records)],
                "totalRows": total,
                "revision": "1",
            }

    def aggregate(self, body: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            entry = self.table(str(body.get("datasetId", "")))
            summary = body.get("summary")
            group_by = body.get("groupBy")
            if summary not in SUMMARIES or not group_by:
                raise StudioError("groupBy and a summary (mean, median, sum, min, max, count) are required")
            value_field = body.get("valueField")
            if summary != "count" and value_field is None:
                raise StudioError("valueField is required for this summary")
            kinds = self._kinds(entry)
            expr = self._filtered(entry, body.get("filter"))
            series_by = [f for f in (body.get("seriesBy") or []) if f != group_by]
            dims = [group_by, *series_by]

            columns = {f"d{i}": text_expr(_col(expr, name)) for i, name in enumerate(dims)}
            if value_field is not None and value_field in kinds:
                column = expr[value_field]
                columns["v"] = column.cast("float64") if kinds[value_field] == "number" else text_expr(_col(expr, value_field)).strip().nullif("").try_cast("float64")
            else:
                columns["v"] = ibis.null("float64")
            shaped = expr.select(**columns)
            measures = {"n": shaped.count()}
            if summary != "count":
                v = shaped.v
                measures["value"] = {"mean": v.mean(), "median": v.median(), "sum": v.sum(), "min": v.min(), "max": v.max()}[summary]
            keys = [f"d{i}" for i in range(len(dims))]
            grouped = shaped.group_by(keys).aggregate(**measures).order_by(keys)
            limit = body.get("limit")
            if isinstance(limit, (int, float)) and limit > 0:
                grouped = grouped.limit(int(limit))
            frame = grouped.execute()
            total = int(expr.count().execute())
            buckets = []
            for row in frame.to_dict("records"):
                count = int(row["n"])
                bucket: dict[str, Any] = {"key": str(row["d0"] if row["d0"] is not None else "")}
                if series_by:
                    bucket["series"] = {name: str(row[f"d{i + 1}"] if row[f"d{i + 1}"] is not None else "") for i, name in enumerate(series_by)}
                bucket["count"] = count
                bucket["value"] = count if summary == "count" else to_json_value(row.get("value"))
                buckets.append(bucket)
            return {"buckets": buckets, "totalRows": total, "revision": "1"}

    def profile(self, body: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            entry = self.table(str(body.get("datasetId", "")))
            kinds = self._kinds(entry)
            expr = self._filtered(entry, body.get("filter"))
            names = self._fields(entry, body.get("fields"))[:PROFILE_FIELD_MAX]
            bins = max(1, int(body.get("bins") or 20))
            top_n = max(0, int(body.get("top") if body.get("top") is not None else 8))
            from .filters import _blank, _Column

            measures: dict[str, ir.Scalar] = {"n": expr.count()}
            for i, name in enumerate(names):
                kind = kinds[name]
                column = expr[name]
                blank = _blank(_Column(column, kind))
                measures[f"nul{i}"] = blank.sum()
                measures[f"dis{i}"] = column.nunique(where=~blank)
                if kind == "number":
                    x = column.cast("float64")
                    measures[f"min{i}"] = x.min()
                    measures[f"max{i}"] = x.max()
                    measures[f"mean{i}"] = x.mean()
                    measures[f"std{i}"] = x.std(how="sample")
                    for label, q in (("p05", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95)):
                        measures[f"{label}_{i}"] = x.quantile(q)
                elif kind in ("date", "datetime"):
                    ms = _epoch_ms(column)
                    measures[f"min{i}"] = ms.min()
                    measures[f"max{i}"] = ms.max()
            stats = expr.aggregate(**measures).execute().to_dict("records")[0]
            total = int(stats["n"])
            profiles = []
            for i, name in enumerate(names):
                kind = kinds[name]
                column = expr[name]
                profile: dict[str, Any] = {
                    "field": name,
                    "count": total,
                    "nulls": int(to_json_value(stats[f"nul{i}"]) or 0),
                    "distinct": int(to_json_value(stats[f"dis{i}"]) or 0),
                    "histogram": None,
                }
                if top_n:
                    text = text_expr(_col(expr, name))
                    top = (
                        expr.filter(~_blank(_Column(column, kind)))
                        .select(v=text)
                        .group_by("v")
                        .aggregate(n=lambda t: t.count())
                        .order_by([ibis.desc("n"), "v"])
                        .limit(top_n)
                        .execute()
                    )
                    profile["top"] = [{"value": str(row["v"]), "count": int(row["n"])} for row in top.to_dict("records")]
                low = to_json_value(stats.get(f"min{i}"))
                high = to_json_value(stats.get(f"max{i}"))
                if kind == "number":
                    profile.update(
                        min=low,
                        max=high,
                        mean=to_json_value(stats[f"mean{i}"]),
                        std=to_json_value(stats[f"std{i}"]),
                        quantiles=None
                        if low is None
                        else {label: to_json_value(stats[f"{label}_{i}"]) for label in ("p05", "p25", "p50", "p75", "p95")},
                    )
                if kind in ("number", "date", "datetime") and low is not None and high is not None:
                    x = column.cast("float64") if kind == "number" else _epoch_ms(column).cast("float64")
                    profile["histogram"] = self._bins(expr, x, float(low), float(high), bins)
                if kind in ("date", "datetime") and low is not None:
                    def iso(ms: float) -> str:
                        moment = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)
                        return moment.strftime("%Y-%m-%d") if kind == "date" else _iso_datetime(moment)

                    profile.update(min=iso(float(low)), max=iso(float(high)))
                profiles.append(profile)
            return {"totalRows": total, "profiles": profiles}

    def _bins(self, expr: ir.Table, x: ir.NumericValue, low: float, high: float, bins: int, by: ir.Value | None = None):
        edges, width = _bin_edges(low, high, bins)
        count = len(edges) - 1
        bucket = ibis.least(ibis.greatest(((x - edges[0]) / width).floor().cast("int64"), 0), count - 1)
        shaped = expr.filter(x.notnull()).select(b=bucket, **({"s": by} if by is not None else {}))
        keys = ["s", "b"] if by is not None else ["b"]
        frame = shaped.group_by(keys).aggregate(n=lambda t: t.count()).execute()
        if by is None:
            counts = [0] * count
            for row in frame.to_dict("records"):
                counts[int(row["b"])] = int(row["n"])
            return {"edges": edges, "counts": counts}
        series: dict[str, list[int]] = {}
        for row in frame.to_dict("records"):
            key = str(row["s"] if row["s"] is not None else "")
            series.setdefault(key, [0] * count)[int(row["b"])] = int(row["n"])
        return {"edges": edges, "series": [{"key": key, "counts": series[key]} for key in sorted(series)]}

    def histogram(self, body: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            entry = self.table(str(body.get("datasetId", "")))
            kinds = self._kinds(entry)
            name = body.get("field")
            kind = kinds.get(name)
            if kind not in ("number", "date", "datetime"):
                raise StudioError(f"Histogram needs a numeric or date field: {name}")
            expr = self._filtered(entry, body.get("filter"))
            column = expr[name]
            x = column.cast("float64") if kind == "number" else _epoch_ms(column).cast("float64")
            stats = expr.aggregate(lo=x.min(), hi=x.max(), n=expr.count(), nul=column.isnull().sum()).execute().to_dict("records")[0]
            total = int(stats["n"])
            nulls = int(to_json_value(stats["nul"]) or 0)
            low, high = to_json_value(stats["lo"]), to_json_value(stats["hi"])
            if low is None or high is None:
                return {"field": name, "edges": [], "series": [], "totalRows": total, "nulls": nulls}
            width = body.get("binWidth")
            if isinstance(width, (int, float)) and width > 0:
                bins = max(1, min(1000, math.ceil((high - low) / width) or 1))
            else:
                bins = max(1, int(body.get("bins") or 20))
            by = body.get("by")
            if by in kinds:
                result = self._bins(expr, x, float(low), float(high), bins, by=text_expr(_col(expr, by)))
                return {"field": name, "edges": result["edges"], "series": result["series"], "totalRows": total, "nulls": nulls}
            result = self._bins(expr, x, float(low), float(high), bins)
            return {"field": name, "edges": result["edges"], "series": [{"key": None, "counts": result["counts"]}], "totalRows": total, "nulls": nulls}

    def sample(self, body: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            entry = self.table(str(body.get("datasetId", "")))
            kinds = self._kinds(entry)
            expr = self._filtered(entry, body.get("filter"))
            n = min(SAMPLE_MAX, max(1, int(body.get("n") or 1000)))
            names = self._fields(entry, body.get("fields"))
            total = int(expr.count().execute())
            sampled = total > n
            source = expr
            if sampled:
                # A seeded Bernoulli sample a little larger than needed, then capped:
                # repeatable on backends that honour the seed.
                fraction = min(1.0, (n * 1.15) / total)
                seed = int(body.get("seed") if body.get("seed") is not None else self.sample_seed)
                source = expr.sample(fraction, seed=seed).limit(n)
            frame = self._project(source, names, kinds).execute()
            return {"rows": _records(frame, kinds), "totalRows": total, "sampled": sampled}

    # --- SQL -----------------------------------------------------------------

    def check_sql(self, text: str) -> tuple[str, list[str]]:
        """Validate read-only SQL; return the statement and the tables it reads."""
        statement = text.strip().rstrip(";").strip()
        if not statement:
            raise StudioError("Write a query first.")
        try:
            parsed = sqlglot.parse(statement, read="duckdb")
        except sqlglot.errors.ParseError as error:
            raise StudioError(f"Couldn't parse the query: {error.errors[0]['description'] if error.errors else error}") from error
        parsed = [node for node in parsed if node is not None]
        if len(parsed) != 1:
            raise StudioError("Run one query at a time.")
        tree = parsed[0]
        if not isinstance(tree, sge.Query):
            raise StudioError("Only read-only queries (SELECT … / WITH …) can run here.")
        for node in tree.walk():
            if isinstance(node, (sge.Insert, sge.Update, sge.Delete, sge.Create, sge.Drop, sge.Alter, sge.Command, sge.Merge, sge.Copy, sge.Pragma, sge.Set, sge.Use)):
                raise StudioError("Only read-only queries (SELECT … / WITH …) can run here.")
            if isinstance(node, (sge.Anonymous, sge.Func)):
                name = node.name if isinstance(node, sge.Anonymous) else (node.sql_name() if hasattr(node, "sql_name") else "")
                if name and BLOCKED_FUNCTIONS.match(str(name)):
                    raise StudioError(f"{name}() reads outside the studio's tables and isn't allowed.")
        ctes = {cte.alias_or_name.lower() for cte in tree.find_all(sge.CTE)}
        tables = []
        for ref in tree.find_all(sge.Table):
            if ref.this is None or not isinstance(ref.this, sge.Identifier):
                raise StudioError("Table functions aren't allowed in SQL here.")
            if ref.args.get("db") or ref.args.get("catalog"):
                raise StudioError(f"Use a table name from the catalog, not {ref.sql()}.")
            name = ref.name
            if name.lower() in ctes:
                continue
            match = next((t for t in self._tables if t.lower() == name.lower()), None)
            if match is None:
                raise StudioError(f"Unknown table {name}. Available: {', '.join(self._tables) or 'none'}.")
            if match not in tables:
                tables.append(match)
        return statement, tables

    def sql(self, body: Mapping[str, Any]) -> dict[str, Any]:
        if not self.allow_sql:
            raise StudioError("SQL is disabled for this source.", 403)
        with self._lock:
            statement, tables = self.check_sql(str(body.get("sql", "")))
            entries = [self._tables[name] for name in tables]
            backends = [ibis.get_backend(e.expr) for e in entries]
            if not entries:
                expr = self._con.sql(statement, dialect="duckdb")
            elif all(e.sql_name for e in entries) and all(b is backends[0] for b in backends):
                expr = backends[0].sql(statement, dialect="duckdb")
            elif len(entries) == 1:
                expr = entries[0].expr.alias(entries[0].id).sql(statement, dialect="duckdb")
            else:
                raise StudioError("These tables live in different places; query them one at a time.")
            try:
                row_count = int(expr.count().execute())
            except Exception as error:  # noqa: BLE001 — surface backend errors as user errors
                raise StudioError(str(error).splitlines()[0]) from error
            self._queries += 1
            table_id = f"query_{self._queries}"
            sql_name = False
            if ibis.get_backend(expr) is self._con:
                # A view lets later queries join this result by name.
                expr = self._con.create_view(table_id, expr, overwrite=True)
                sql_name = True
            entry = Table(id=table_id, label=f"Query {self._queries}", expr=expr, kind="query", sql=statement, row_count=row_count, sql_name=sql_name)
            entry.fields()
            self._tables[table_id] = entry
            return entry.info()

    # --- uploads -------------------------------------------------------------

    def upload(self, filename: str, data: bytes) -> dict[str, Any]:
        if not self.allow_upload:
            raise StudioError("Uploads are disabled for this source.", 403)
        frames = _read_bytes(filename, data)
        infos = []
        with self._lock:
            for name, frame in frames:
                table_id = _slug(name, self._tables)
                infos.append(self.add(table_id, frame, label=name, description=f"{Path(filename).suffix.lstrip('.').upper()} upload"))
        return {"tables": infos}


def _col(expr: ir.Table, name: str):
    from .filters import _column

    return _column(expr, name)


def _read_bytes(filename: str, data: bytes) -> list[tuple[str, Any]]:
    """Parse an uploaded file in Python (never through SQL file access)."""
    import pandas as pd
    import pyarrow as pa

    lower = filename.lower()
    buffer = io.BytesIO(data)
    if lower.endswith((".parquet", ".pq")):
        import pyarrow.parquet as pq

        return [(filename, pq.read_table(buffer))]
    if lower.endswith((".csv", ".txt", ".tsv")):
        import pyarrow.csv as pacsv

        options = pacsv.ParseOptions(delimiter="\t" if lower.endswith(".tsv") else ",")
        return [(filename, pacsv.read_csv(buffer, parse_options=options))]
    if lower.endswith((".json", ".jsonl", ".ndjson")):
        text = data.decode("utf-8").strip()
        try:
            parsed = json.loads(text)
            rows = parsed if isinstance(parsed, list) else next((v for v in parsed.values() if isinstance(v, list)), [parsed])
        except json.JSONDecodeError:
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        return [(filename, pa.Table.from_pylist(rows))]
    if lower.endswith(".xlsx"):
        try:
            sheets = pd.read_excel(buffer, sheet_name=None)
        except ImportError as error:
            raise StudioError("Excel files need openpyxl: pip install 'sheetbase-studio[excel]'") from error
        return [(filename if len(sheets) == 1 else f"{filename} · {sheet}", frame) for sheet, frame in sheets.items()]
    raise StudioError(f"Unsupported file type: {filename}. Use CSV, TSV, Parquet, JSON or Excel (.xlsx).")


def _read_path(path: Path) -> Any:
    return _read_bytes(path.name, path.read_bytes())[0][1]
