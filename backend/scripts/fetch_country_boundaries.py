"""Download Natural Earth 1:10m country boundaries for offline toll calculation.

Run once from the backend directory::

    python scripts/fetch_country_boundaries.py

Writes ``data/country_boundaries.geojson`` (not used at runtime over HTTP).
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_OUTPUT_PATH = _BACKEND_ROOT / "data" / "country_boundaries.geojson"

# Natural Earth 1:10m Admin 0 – Countries (GeoJSON mirror)
_SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_10m_admin_0_countries.geojson"
)


def main() -> None:
    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {_SOURCE_URL} ...")
    urllib.request.urlretrieve(_SOURCE_URL, _OUTPUT_PATH)
    size_mb = _OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"Saved {_OUTPUT_PATH} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
