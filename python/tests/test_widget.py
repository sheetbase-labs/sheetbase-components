import pandas as pd
import pytest

pytest.importorskip("anywidget")

from sheetbase.widget import Studio  # noqa: E402


def test_widget_answers_requests_over_the_comm():
    studio = Studio(pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "x"]}), height=500)
    sent = []
    studio.send = sent.append  # the comm isn't open outside a kernel
    studio._on_message(studio, {"type": "request", "id": 1, "method": "GET", "path": "/api/studio/catalog"}, [])
    studio._on_message(studio, {"type": "request", "id": 2, "method": "POST", "path": "/api/explorer/aggregate", "body": {"datasetId": "data", "groupBy": "b", "summary": "count"}}, [])
    studio._on_message(studio, {"type": "request", "id": 3, "method": "POST", "path": "/api/studio/upload", "filename": "more.csv"}, [b"c\n1\n2\n"])
    studio._on_message(studio, {"type": "request", "id": 4, "method": "GET", "path": "/api/nope"}, [])
    assert [message["id"] for message in sent] == [1, 2, 3, 4]
    assert sent[0]["body"]["tables"][0]["id"] == "data"
    assert {b["key"]: b["count"] for b in sent[1]["body"]["buckets"]} == {"x": 2, "y": 1}
    assert sent[2]["body"]["tables"][0]["id"] == "more"
    assert sent[3]["status"] == 404
    assert studio.height == 500


def test_widget_add_notifies_the_front_end():
    studio = Studio()
    sent = []
    studio.send = sent.append
    studio.add("later", pd.DataFrame({"x": [1]}))
    assert sent == [{"type": "catalog-changed"}]
    assert [t["id"] for t in studio.backend.catalog()["tables"]] == ["later"]
