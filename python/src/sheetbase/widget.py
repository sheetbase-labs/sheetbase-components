"""Sheetbase Studio as a notebook widget (Jupyter, JupyterLab, VS Code, marimo).

The widget runs the same Studio UI as the server; requests travel over the
widget's comm channel to a ``StudioBackend`` in the kernel, so data never
leaves the Python process except as the pages, buckets and profiles the UI
asks for.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .backend import StudioBackend
from .routes import dispatch
from .server import static_dir

try:
    import anywidget
    import traitlets
except ImportError as error:  # pragma: no cover — import-time guidance
    raise ImportError("The Studio widget needs anywidget: pip install 'sheetbase-studio[widget]'") from error

__all__ = ["Studio", "explore"]


def _asset(name: str) -> str | Path:
    path = static_dir() / "widget" / name
    if path.exists():
        return path
    return "" if name.endswith(".css") else _UNBUILT_ESM


_UNBUILT_ESM = """export default { render({ el }) {
  el.innerHTML = '<p style="font: 13px system-ui; padding: 12px">The Studio widget isn\\'t built into this install. ' +
    'Build it with <code>bun run --filter @sheetbase-labs/sheetbase-studio build:python</code>.</p>'
} }"""


class Studio(anywidget.AnyWidget):
    """Explore tables in Sheetbase Studio inside a notebook.

    >>> Studio(df)                              # one DataFrame
    >>> Studio(runs=df, plates=con.table("plates"))
    """

    _esm = _asset("widget.js")
    _css = _asset("widget.css")
    height = traitlets.Int(680).tag(sync=True)
    title = traitlets.Unicode("Studio").tag(sync=True)
    theme = traitlets.Unicode("system").tag(sync=True)

    def __init__(self, data: Any = None, *, height: int = 680, title: str = "Studio", backend: StudioBackend | None = None, **tables: Any):
        super().__init__(height=height, title=title)
        named: dict[str, Any] = {}
        if isinstance(data, dict):
            named.update(data)
        elif data is not None:
            named["data"] = data
        named.update(tables)
        self.backend = backend or StudioBackend(label="Notebook")
        for name, value in named.items():
            self.backend.add(name, value)
        self.on_msg(self._on_message)

    def add(self, name: str, data: Any) -> None:
        """Add a table; the open Studio picks it up on its next catalog refresh."""
        self.backend.add(name, data)
        self.send({"type": "catalog-changed"})

    def _on_message(self, _widget: Any, content: dict[str, Any], buffers: list[bytes]) -> None:
        if not isinstance(content, dict) or content.get("type") != "request":
            return
        upload = None
        if content.get("path") == "/api/studio/upload" and buffers:
            upload = (str(content.get("filename") or "upload"), bytes(buffers[0]))
        status, payload = dispatch(
            self.backend,
            str(content.get("method", "GET")),
            str(content.get("path", "")),
            params=content.get("params") or {},
            body=content.get("body"),
            upload=upload,
        )
        self.send({"type": "response", "id": content.get("id"), "status": status, "body": payload})


def explore(data: Any = None, **tables: Any) -> Studio:
    """Open data in the Studio widget: ``sheetbase.explore(df)``."""
    return Studio(data, **tables)
