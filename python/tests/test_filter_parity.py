"""The Ibis compiler must return the rows buildPredicate returns (shared fixture)."""

import json
from datetime import datetime, timezone

import ibis
import pandas as pd
import pytest

from sheetbase import compile_filter
from sheetbase.filters import UnsupportedFilter

from conftest import FIXTURE

PANDAS_TYPES = {"text": "string", "number": "float64", "boolean": "boolean"}


def parity_table(parity, con):
    frame = pd.DataFrame(parity["rows"])
    for field in parity["fields"]:
        name, kind = field["id"], field["dataType"]
        if kind == "date":
            frame[name] = pd.to_datetime(frame[name]).dt.date
        elif kind == "datetime":
            frame[name] = pd.to_datetime(frame[name], utc=True).dt.tz_localize(None)
        else:
            frame[name] = frame[name].astype(PANDAS_TYPES[kind])
    return con.create_table("parity", frame, overwrite=True)


@pytest.fixture(scope="module")
def table(parity):
    return parity_table(parity, ibis.duckdb.connect())


CASES = json.loads(FIXTURE.read_text())["cases"]


def test_fixture_has_cases():
    assert len(CASES) > 60


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_matches_build_predicate(parity, table, case):
    now = datetime.fromisoformat(parity["now"].replace("Z", "+00:00"))
    predicate = compile_filter(case["filter"], table, now=now)
    expr = table.filter(predicate) if predicate is not None else table
    got = sorted(expr.select("id").execute()["id"].tolist())
    assert got == case["expected"], case["name"]


def test_unknown_operator_is_an_error(table):
    tree = {"type": "group", "combinator": "AND", "children": [{"type": "condition", "field": "id", "operator": "regex", "value": "x"}]}
    with pytest.raises(UnsupportedFilter):
        compile_filter(tree, table, now=datetime(2026, 1, 1, tzinfo=timezone.utc))
