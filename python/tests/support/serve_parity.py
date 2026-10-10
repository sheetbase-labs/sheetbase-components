"""Serve the filter-parity fixture (typed) for the TypeScript cross-executor test.

    python tests/support/serve_parity.py PORT
"""

import json
import sys
from pathlib import Path

import pandas as pd

from sheetbase import StudioBackend, serve

FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "studio" / "fixtures" / "filter-parity.json"


def main() -> None:
    parity = json.loads(FIXTURE.read_text())
    frame = pd.DataFrame(parity["rows"])
    types = {"text": "string", "number": "float64", "boolean": "boolean"}
    for field in parity["fields"]:
        name, kind = field["id"], field["dataType"]
        if kind == "date":
            frame[name] = pd.to_datetime(frame[name]).dt.date
        elif kind == "datetime":
            frame[name] = pd.to_datetime(frame[name], utc=True).dt.tz_localize(None)
        else:
            frame[name] = frame[name].astype(types[kind])
    serve(StudioBackend({"runs": frame}), port=int(sys.argv[1]), open_browser=False, cors=True)


if __name__ == "__main__":
    main()
