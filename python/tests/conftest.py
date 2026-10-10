import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "packages" / "studio" / "fixtures" / "filter-parity.json"


@pytest.fixture(scope="session")
def parity():
    return json.loads(FIXTURE.read_text())
