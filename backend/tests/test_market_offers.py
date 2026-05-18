"""Unit tests for market-offer persistence helpers."""

from __future__ import annotations

import pytest
from geoalchemy2.elements import WKTElement

from app.services.market_offers import _ewkt_to_wkt_element


def test_ewkt_to_wkt_element_parses_point() -> None:
    element = _ewkt_to_wkt_element("SRID=4326;POINT(21.01 52.22)")
    assert isinstance(element, WKTElement)
    assert element.srid == 4326
    wkt = getattr(element, "data", str(element))
    assert "21.01" in wkt and "52.22" in wkt


def test_ewkt_to_wkt_element_rejects_invalid() -> None:
    with pytest.raises(ValueError, match="Invalid EWKT"):
        _ewkt_to_wkt_element("POINT(1 2)")
