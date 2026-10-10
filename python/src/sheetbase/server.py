"""A small local HTTP server: the Studio UI plus the Studio API over a backend."""

from __future__ import annotations

import json
import mimetypes
import secrets
import threading
import webbrowser
from email.parser import BytesParser
from email.policy import default as email_policy
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import parse_qs, urlparse

from .backend import StudioBackend
from .routes import dispatch

__all__ = ["serve", "StudioServer", "static_dir"]

MAX_UPLOAD_BYTES = 2 * 1024**3


def static_dir() -> Path:
    """Where the built Studio UI lives inside the installed package."""
    return Path(str(resources.files("sheetbase") / "static"))


def _parse_multipart(content_type: str, body: bytes) -> tuple[str, bytes] | None:
    message = BytesParser(policy=email_policy).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    for part in message.iter_parts():
        if part.get_param("name", header="content-disposition") == "file":
            return part.get_filename() or "upload", part.get_payload(decode=True) or b""
    return None


class StudioServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], backend: StudioBackend, *, token: str | None, cors: bool):
        self.backend = backend
        self.token = token
        self.cors = cors
        super().__init__(address, _Handler)

    @property
    def url(self) -> str:
        host, port = self.server_address[:2]
        shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
        return f"http://{shown}:{port}/" + (f"?token={self.token}" if self.token else "")


class _Handler(BaseHTTPRequestHandler):
    server: StudioServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — stdlib signature
        pass

    # --- plumbing ---

    def _send(self, status: int, payload: bytes, content_type: str, extra: Mapping[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.server.cors:
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
            self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _json(self, status: int, payload: Any) -> None:
        self._send(status, json.dumps(payload, allow_nan=False, default=str).encode("utf-8"), "application/json; charset=utf-8")

    def _authorised(self, query: Mapping[str, list[str]]) -> bool:
        token = self.server.token
        if not token:
            return True
        header = self.headers.get("Authorization", "")
        supplied = header[7:] if header.lower().startswith("bearer ") else (query.get("token") or [""])[0]
        return secrets.compare_digest(supplied, token)

    # --- verbs ---

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(HTTPStatus.NO_CONTENT, b"", "text/plain")

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path.startswith("/api/"):
            if not self._authorised(query):
                self._json(401, {"error": "Missing or wrong token."})
                return
            params = {key: values[-1] for key, values in query.items()}
            status, payload = dispatch(self.server.backend, "GET", url.path, params=params)
            self._json(status, payload)
            return
        self._static(url.path)

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if not self._authorised(parse_qs(url.query)):
            self._json(401, {"error": "Missing or wrong token."})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD_BYTES:
            self._json(413, {"error": "File too large."})
            return
        raw = self.rfile.read(length) if length else b""
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("multipart/form-data"):
            upload = _parse_multipart(content_type, raw)
            status, payload = dispatch(self.server.backend, "POST", url.path, upload=upload)
        else:
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "Body must be JSON."})
                return
            status, payload = dispatch(self.server.backend, "POST", url.path, body=body)
        self._json(status, payload)

    def _static(self, path: str) -> None:
        root = static_dir() / "app"
        index = next((root / name for name in ("index.html", "standalone.html") if (root / name).exists()), root / "index.html")
        if not index.exists():
            self._send(200, _UNBUILT.encode("utf-8"), "text/html; charset=utf-8")
            return
        relative = path.lstrip("/") or "index.html"
        target = (root / relative).resolve()
        if root.resolve() not in target.parents and target != root.resolve() or not target.is_file():
            target = index  # single-page app: unknown paths get the shell
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".wasm":
            content_type = "application/wasm"
        self._send(200, target.read_bytes(), content_type)


_UNBUILT = """<!doctype html><meta charset="utf-8"><title>Sheetbase Studio</title>
<body style="font: 14px system-ui; padding: 40px; max-width: 640px">
<h1 style="font-size: 18px">The Studio UI isn't built into this install</h1>
<p>The API is running. Build the UI from the repository with
<code>bun run --filter @sheetbase-labs/sheetbase-studio build:python</code>, or install a released wheel.</p>
</body>"""


def serve(
    data: Any = None,
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    token: str | bool | None = None,
    open_browser: bool = True,
    cors: bool = False,
    block: bool = True,
    label: str = "Python",
    **tables: Any,
) -> StudioServer:
    """Serve the Studio for some data.

    ``data`` may be a ``StudioBackend``, a mapping of name → table, or a single
    table (pandas/polars/pyarrow data, an Ibis table, or a file path); keyword
    arguments add more named tables::

        sheetbase.serve(df)                                   # one DataFrame
        sheetbase.serve(runs=df, plates=con.table("plates"))  # several
        sheetbase.serve("measurements.parquet")

    The server binds to localhost. Pass ``token=True`` for a random access
    token (always do this with a non-local ``host``).
    """
    if isinstance(data, StudioBackend):
        backend = data
        for name, value in tables.items():
            backend.add(name, value)
    else:
        named: dict[str, Any] = {}
        if isinstance(data, Mapping):
            named.update(data)
        elif data is not None:
            named[_default_name(data)] = data
        named.update(tables)
        backend = StudioBackend(named, label=label)
    secret = secrets.token_urlsafe(18) if token is True else (token or None)
    server = StudioServer((host, port), backend, token=secret, cors=cors)
    print(f"Sheetbase Studio: {server.url}", flush=True)
    if open_browser:
        threading.Timer(0.3, lambda: webbrowser.open(server.url)).start()
    if block:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    else:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _default_name(data: Any) -> str:
    if isinstance(data, (str, Path)):
        return Path(data).name
    try:
        import ibis.expr.types as ir

        if isinstance(data, ir.Table):
            return data.get_name()
    except Exception:  # noqa: BLE001 — unnamed expressions fall through
        pass
    return "data"
