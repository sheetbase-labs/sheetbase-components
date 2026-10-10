"""`sheetbase serve` — open files or a database in Sheetbase Studio."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .backend import StudioBackend


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sheetbase", description="Explore data in Sheetbase Studio.")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Serve files and/or a database in the Studio")
    serve.add_argument("files", nargs="*", type=Path, help="CSV, TSV, Parquet, JSON or Excel files")
    serve.add_argument("--db", help="Ibis connection URL, e.g. postgres://user@host/db or duckdb://warehouse.duckdb")
    serve.add_argument("--table", action="append", default=[], help="Only these tables from --db (repeatable)")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--token", action="store_true", help="Require a random access token (use with a non-local --host)")
    serve.add_argument("--no-browser", action="store_true")
    serve.add_argument("--no-sql", action="store_true", help="Hide the SQL editor")
    serve.add_argument("--cors", action="store_true", help="Allow cross-origin requests (UI served elsewhere)")
    args = parser.parse_args(argv)

    if args.command == "serve":
        from .server import serve as run

        backend = StudioBackend(label="sheetbase serve", allow_sql=not args.no_sql)
        for path in args.files:
            if not path.exists():
                print(f"No such file: {path}", file=sys.stderr)
                return 2
            backend.add(path.name, path, label=path.name)
        if args.db:
            import ibis

            con = ibis.connect(args.db)
            names = args.table or con.list_tables()
            for name in names:
                backend.add(name, con.table(name), label=name)
        if not args.files and not args.db:
            print("Nothing to serve yet: open files from the Studio, or pass files / --db.", file=sys.stderr)
        if not args.host.startswith("127.") and args.host != "localhost" and not args.token:
            print("Warning: serving beyond localhost without --token.", file=sys.stderr)
        run(backend, host=args.host, port=args.port, token=args.token or None, open_browser=not args.no_browser, cors=args.cors)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
