"""The Studio wire contract, independent of transport (HTTP server or notebook comm)."""

from __future__ import annotations

import json
import traceback
from typing import Any, Mapping

from .backend import StudioBackend, StudioError
from .filters import UnsupportedFilter

__all__ = ["dispatch"]


def _page_params(params: Mapping[str, Any]) -> dict[str, Any]:
    """`GET /api/table/pages` query params → the backend's page request."""

    def parsed(name: str) -> Any:
        value = params.get(name)
        if isinstance(value, str):
            return json.loads(value) if value else None
        return value

    field_ids = params.get("fieldIds") or ""
    return {
        "datasetId": params.get("datasetId", ""),
        "rowStart": int(params.get("rowStart") or 0),
        "rowCount": int(params.get("rowCount") or 200),
        "fieldIds": [f for f in field_ids.split(",") if f] if isinstance(field_ids, str) else list(field_ids),
        "sort": parsed("sort"),
        "filters": parsed("filters"),
        "filterLogic": params.get("filterLogic"),
        "filterTree": parsed("filterTree"),
    }


def dispatch(
    backend: StudioBackend,
    method: str,
    path: str,
    params: Mapping[str, Any] | None = None,
    body: Any = None,
    upload: tuple[str, bytes] | None = None,
) -> tuple[int, Any]:
    """Route one request; returns ``(status, json_payload)`` and never raises."""
    params = params or {}
    try:
        if method == "GET" and path == "/api/studio/catalog":
            return 200, backend.catalog()
        if method == "GET" and path == "/api/table/pages":
            return 200, backend.page(_page_params(params))
        if method == "POST" and path == "/api/explorer/aggregate":
            return 200, backend.aggregate(body or {})
        if method == "POST" and path == "/api/studio/profile":
            return 200, backend.profile(body or {})
        if method == "POST" and path == "/api/studio/histogram":
            return 200, backend.histogram(body or {})
        if method == "POST" and path == "/api/studio/sample":
            return 200, backend.sample(body or {})
        if method == "POST" and path == "/api/studio/sql":
            return 200, backend.sql(body or {})
        if method == "POST" and path == "/api/studio/upload":
            if upload is None:
                return 400, {"error": "Send the file as multipart form data under 'file'."}
            return 200, backend.upload(*upload)
        return 404, {"error": f"No route for {method} {path}"}
    except StudioError as error:
        return error.status, {"error": str(error)}
    except UnsupportedFilter as error:
        return 400, {"error": str(error)}
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        return 400, {"error": f"Bad request: {error}"}
    except Exception as error:  # noqa: BLE001 — report, don't crash the server
        traceback.print_exc()
        return 500, {"error": str(error).splitlines()[0] if str(error) else type(error).__name__}
