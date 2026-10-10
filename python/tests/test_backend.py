import io
import json
import threading
import urllib.error
import urllib.request

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from sheetbase import StudioBackend
from sheetbase.routes import dispatch
from sheetbase.server import StudioServer

GTE0 = {"type": "group", "combinator": "AND", "children": [{"type": "condition", "field": "result", "operator": "gte", "value": 0}]}


@pytest.fixture()
def backend(parity):
    frame = pd.DataFrame(parity["rows"])
    frame["collected"] = pd.to_datetime(frame["collected"]).dt.date
    frame["measured_at"] = pd.to_datetime(frame["measured_at"], utc=True).dt.tz_localize(None)
    frame["passed"] = frame["passed"].astype("boolean")
    return StudioBackend({"runs": frame})


def test_catalog_types(backend):
    catalog = backend.catalog()
    (table,) = catalog["tables"]
    assert table["id"] == "runs" and table["rowCount"] == 10
    kinds = {f["id"]: f["dataType"] for f in table["fields"]}
    assert kinds == {"id": "text", "status": "text", "result": "number", "count": "number", "passed": "boolean", "collected": "date", "measured_at": "datetime", "code": "text", "notes": "text"}
    assert catalog["capabilities"]["sql"] is True


def test_page_filters_sorts_and_formats(backend):
    page = backend.page({"datasetId": "runs", "rowStart": 0, "rowCount": 3, "fieldIds": ["id", "result", "collected", "measured_at"], "sort": [{"fieldId": "result", "direction": "desc"}], "filterTree": GTE0})
    assert page["totalRows"] == 8
    assert [r["values"]["id"] for r in page["records"]] == ["r08", "r05", "r06"]
    assert page["records"][0]["values"] == {"id": "r08", "result": 1e6, "collected": "2024-02-29", "measured_at": "2024-02-29T18:45:00.000Z"}


def test_flat_filters_are_honoured(backend):
    page = backend.page({"datasetId": "runs", "rowStart": 0, "rowCount": 50, "fieldIds": ["id"], "filters": [{"fieldId": "status", "operator": "eq", "value": "pending"}], "filterLogic": "and"})
    assert sorted(r["values"]["id"] for r in page["records"]) == ["r03", "r09"]


def test_aggregate_matches_reference(backend):
    result = backend.aggregate({"datasetId": "runs", "groupBy": "passed", "summary": "mean", "valueField": "result", "filter": GTE0})
    by_key = {b["key"]: b for b in result["buckets"]}
    assert result["totalRows"] == 8
    assert set(by_key) == {"", "false", "true"}
    assert by_key["true"]["count"] == 5
    assert by_key["true"]["value"] == pytest.approx((42.5 + 0 + 99.999 + 0.1 + 50) / 5)
    count = backend.aggregate({"datasetId": "runs", "groupBy": "status", "seriesBy": ["passed"], "summary": "count"})
    assert sum(b["count"] for b in count["buckets"]) == 10
    assert all("series" in b for b in count["buckets"])


def test_profile(backend):
    profile = backend.profile({"datasetId": "runs", "fields": [], "bins": 5, "top": 3})
    by_field = {p["field"]: p for p in profile["profiles"]}
    result = by_field["result"]
    assert (result["nulls"], result["distinct"], result["min"], result["max"]) == (1, 9, -1.25, 1e6)
    assert result["quantiles"]["p50"] == pytest.approx(42.5)
    assert sum(result["histogram"]["counts"]) == 9
    status = by_field["status"]
    assert status["nulls"] == 2  # null and blank
    assert status["top"][0] == {"value": "Complete", "count": 2}
    collected = by_field["collected"]
    assert (collected["min"], collected["max"]) == ("2024-02-29", "2026-03-15")


def test_histogram_with_series(backend):
    result = backend.histogram({"datasetId": "runs", "field": "count", "bins": 6, "by": "passed"})
    assert len(result["edges"]) == 7
    assert sum(sum(s["counts"]) for s in result["series"]) == 10
    with pytest.raises(Exception):
        backend.histogram({"datasetId": "runs", "field": "status"})


def test_sample_is_bounded_and_filtered(backend):
    sample = backend.sample({"datasetId": "runs", "fields": ["id", "result"], "n": 3, "filter": GTE0, "seed": 7})
    assert sample["sampled"] is True and sample["totalRows"] == 8
    assert len(sample["rows"]) <= 3
    assert all(row["result"] >= 0 for row in sample["rows"])
    everything = backend.sample({"datasetId": "runs", "fields": ["id"], "n": 50})
    assert everything["sampled"] is False and len(everything["rows"]) == 10


def test_sql_registers_query_tables(backend):
    info = backend.sql({"sql": "SELECT status, avg(result) AS mean_result, count(*) AS n FROM runs GROUP BY status;"})
    assert info["kind"] == "query" and info["id"] == "query_1"
    assert [f["dataType"] for f in info["fields"]] == ["text", "number", "number"]
    page = backend.page({"datasetId": "query_1", "rowStart": 0, "rowCount": 50, "fieldIds": []})
    assert page["totalRows"] == info["rowCount"]
    joined = backend.sql({"sql": "SELECT q.n, r.id FROM query_1 q JOIN runs r USING (status)"})
    assert joined["rowCount"] > 0


@pytest.mark.parametrize(
    "statement, message",
    [
        ("DROP TABLE runs", "read-only"),
        ("SELECT 1; DROP TABLE runs", "one query"),
        ("DELETE FROM runs", "read-only"),
        ("WITH x AS (SELECT 1) DELETE FROM runs", ""),
        ("SELECT * FROM read_csv('/etc/passwd')", ""),
        ("SELECT * FROM 'data.parquet'", ""),
        ("SELECT * FROM other_table", "Unknown table"),
        ("SELECT * FROM main.runs", "catalog"),
        ("COPY runs TO 'x.csv'", ""),
        ("ATTACH 'x.db'", ""),
        ("SET enable_external_access = true", ""),
    ],
)
def test_sql_refuses_anything_but_reads(backend, statement, message):
    status, payload = dispatch(backend, "POST", "/api/studio/sql", body={"sql": statement})
    assert status >= 400
    assert message.lower() in payload["error"].lower()
    assert backend.page({"datasetId": "runs", "rowStart": 0, "rowCount": 1, "fieldIds": ["id"]})["totalRows"] == 10


def test_uploads(backend):
    csv = backend.upload("Plate Reads.csv", b"well,od,day\nA1,0.5,2026-01-02\nA2,0.7,2026-01-03\n")
    (table,) = csv["tables"]
    assert table["id"] == "plate_reads" and table["rowCount"] == 2
    assert [f["dataType"] for f in table["fields"]] == ["text", "number", "date"]
    buffer = io.BytesIO()
    pq.write_table(pa.table({"i": [1, 2, 3]}), buffer)
    assert backend.upload("plate reads.parquet", buffer.getvalue())["tables"][0]["id"] == "plate_reads_2"
    assert backend.upload("rows.json", json.dumps([{"a": 1}, {"a": 2}]).encode())["tables"][0]["rowCount"] == 2
    assert backend.upload("rows.ndjson", b'{"a": 1}\n{"a": 2}\n')["tables"][0]["rowCount"] == 2
    status, payload = dispatch(backend, "POST", "/api/studio/upload", upload=("notes.docx", b"x"))
    assert status == 400 and "Unsupported" in payload["error"]


def test_unknown_table_and_operator(backend):
    assert dispatch(backend, "GET", "/api/table/pages", params={"datasetId": "nope"})[0] == 404
    tree = {"type": "group", "combinator": "AND", "children": [{"type": "condition", "field": "id", "operator": "regex", "value": "x"}]}
    status, payload = dispatch(backend, "POST", "/api/explorer/aggregate", body={"datasetId": "runs", "groupBy": "id", "summary": "count", "filter": tree})
    assert status == 400 and "regex" in payload["error"]


def _request(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_http_server_round_trip(backend):
    server = StudioServer(("127.0.0.1", 0), backend, token="s3cret", cors=False)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        assert _request(f"{base}/api/studio/catalog")[0] == 401
        auth = {"Authorization": "Bearer s3cret"}
        status, catalog = _request(f"{base}/api/studio/catalog", headers=auth)
        assert status == 200 and catalog["tables"][0]["id"] == "runs"
        tree = json.dumps(GTE0)
        status, page = _request(f"{base}/api/table/pages?datasetId=runs&rowStart=0&rowCount=2&fieldIds=id&filterTree={urllib.request.quote(tree)}&token=s3cret")
        assert status == 200 and page["totalRows"] == 8
        body = json.dumps({"datasetId": "runs", "groupBy": "status", "summary": "count"}).encode()
        status, agg = _request(f"{base}/api/explorer/aggregate", data=body, headers={**auth, "content-type": "application/json"})
        assert status == 200 and agg["totalRows"] == 10
        boundary = "----sheetbase"
        form = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"up.csv\"\r\nContent-Type: text/csv\r\n\r\n").encode() + b"a,b\n1,2\n" + f"\r\n--{boundary}--\r\n".encode()
        status, uploaded = _request(f"{base}/api/studio/upload", data=form, headers={**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"})
        assert status == 200 and uploaded["tables"][0]["id"] == "up"
    finally:
        server.shutdown()
        server.server_close()


def test_polars_and_arrow_inputs():
    pl = pytest.importorskip("polars")
    backend = StudioBackend({"p": pl.DataFrame({"a": [1, 2, 3], "s": ["x", "y", None]}), "arrow": pa.table({"z": [1.5, 2.5]})})
    tables = {t["id"]: t for t in backend.catalog()["tables"]}
    assert tables["p"]["rowCount"] == 3 and tables["arrow"]["rowCount"] == 2
    assert backend.profile({"datasetId": "p", "fields": ["s"]})["profiles"][0]["nulls"] == 1


def test_database_tables_stay_in_their_backend(tmp_path):
    import ibis

    con = ibis.duckdb.connect(str(tmp_path / "warehouse.duckdb"))
    con.create_table("batches", pd.DataFrame({"batch": ["B1", "B2", "B3"], "yield_pct": [81.0, 77.5, 90.2]}))
    backend = StudioBackend({"local": pd.DataFrame({"x": [1]})})
    info = backend.add("batches", con.table("batches"))
    assert info["rowCount"] is None  # counted on first use, not at connect time
    assert backend.page({"datasetId": "batches", "rowStart": 0, "rowCount": 10, "fieldIds": []})["totalRows"] == 3
    result = backend.sql({"sql": "SELECT batch FROM batches WHERE yield_pct > 80"})
    assert result["rowCount"] == 2
    status, payload = dispatch(backend, "POST", "/api/studio/sql", body={"sql": "SELECT * FROM batches, local"})
    assert status == 400 and "different places" in payload["error"]
