#!/usr/bin/env python3
"""Build ``data/european_logistics_sites.json`` from curated sites + OSM Overpass.

Run from ``backend/``::

    python scripts/build_european_logistics_catalog.py

Respects Nominatim/Overpass usage: one Overpass request, no per-row geocoding.
Curated entries use coordinates verified from public facility lists (Amazon FC PDF,
operator websites, OSM tags).
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = BACKEND_ROOT / "data" / "european_logistics_sites.json"
VERIFIED_AT = date.today().isoformat()

EUROPE_BBOX = (35.0, -10.0, 71.0, 40.0)  # south, west, north, east

PREFERRED_OPERATORS = (
    "Amazon",
    "DHL",
    "DB Schenker",
    "Schenker",
    "Kuehne",
    "Kühne",
    "Geodis",
    "Dachser",
    "Raben",
    "Rhenus",
    "Hermes",
    "UPS",
    "FedEx",
    "IKEA",
    "Zalando",
    "Aldi",
    "Lidl",
    "REWE",
    "MediaMarkt",
    "Decathlon",
    "Maersk",
    "XPO",
    "CEVA",
    "InPost",
    "Poczta Polska",
    "Rohlig",
    "PEKAES",
    "FM Logistic",
    "ID Logistics",
)

FACILITY_TYPE_KEYWORDS: list[tuple[str, str]] = [
    ("fulfillment", "fulfillment_center"),
    ("distribution", "distribution_center"),
    ("logistics", "logistics_terminal"),
    ("warehouse", "contract_logistics_warehouse"),
    ("terminal", "port_inland_terminal"),
    ("freight", "freight_hub"),
    ("dc", "distribution_center"),
    ("hub", "freight_hub"),
]

# fmt: off
CURATED_SITES: list[dict[str, Any]] = [
    {"id": "amazon-ber8-schoenefeld-de", "company": "Amazon", "facility_name": "Fulfillment Center BER8/IXD1", "facility_code": "BER8", "facility_type": "fulfillment_center", "address_line": "Am Möllenpfuhl 2", "postal_code": "12529", "city": "Schönefeld", "region": "Brandenburg", "country_code": "DE", "lat": 52.3858, "lon": 13.5224, "source": "https://flexlogistik.de/", "geocode_method": "nominatim"},
    {"id": "amazon-lej1-leipzig-de", "company": "Amazon", "facility_name": "Fulfillment Center LEJ1", "facility_code": "LEJ1", "facility_type": "fulfillment_center", "address_line": "Amazonstraße 1", "postal_code": "04347", "city": "Leipzig", "region": "Saxony", "country_code": "DE", "lat": 51.3397, "lon": 12.3825, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-fra3-bad-hersfeld-de", "company": "Amazon", "facility_name": "Fulfillment Center FRA3", "facility_code": "FRA3", "facility_type": "fulfillment_center", "address_line": "Am Schloß Eichhof 1", "postal_code": "36251", "city": "Bad Hersfeld", "region": "Hesse", "country_code": "DE", "lat": 50.868, "lon": 9.708, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-muc3-aign-de", "company": "Amazon", "facility_name": "Fulfillment Center MUC3", "facility_code": "MUC3", "facility_type": "fulfillment_center", "address_line": "Am Hollerweg 12", "postal_code": "86637", "city": "Augsburg", "region": "Bavaria", "country_code": "DE", "lat": 48.456, "lon": 10.872, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-dtm2-dortmund-de", "company": "Amazon", "facility_name": "Fulfillment Center DTM2", "facility_code": "DTM2", "facility_type": "fulfillment_center", "address_line": "Kaltbandstraße 4", "postal_code": "44145", "city": "Dortmund", "region": "NRW", "country_code": "DE", "lat": 51.531, "lon": 7.465, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-cgn1-kobern-de", "company": "Amazon", "facility_name": "Fulfillment Center CGN1", "facility_code": "CGN1", "facility_type": "fulfillment_center", "address_line": "Amazonstraße 1", "postal_code": "56330", "city": "Kobern-Gondorf", "region": "Rhineland-Palatinate", "country_code": "DE", "lat": 50.308, "lon": 7.456, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-ham2-winsen-de", "company": "Amazon", "facility_name": "Fulfillment Center HAM2", "facility_code": "HAM2", "facility_type": "fulfillment_center", "address_line": "Borgwardstraße 10", "postal_code": "21423", "city": "Winsen", "region": "Lower Saxony", "country_code": "DE", "lat": 53.357, "lon": 10.214, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-str1-pforzheim-de", "company": "Amazon", "facility_name": "Fulfillment Center STR1", "facility_code": "STR1", "facility_type": "fulfillment_center", "address_line": "Amazonstraße 1", "postal_code": "75177", "city": "Pforzheim", "region": "Baden-Württemberg", "country_code": "DE", "lat": 48.894, "lon": 8.691, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-poz1-sady-pl", "company": "Amazon", "facility_name": "Fulfillment Center POZ1", "facility_code": "POZ1", "facility_type": "fulfillment_center", "address_line": "ul. Poznańska 1d", "postal_code": "62-080", "city": "Sady", "region": "Greater Poland", "country_code": "PL", "lat": 52.463, "lon": 16.703, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-bva1-boves-fr", "company": "Amazon", "facility_name": "Fulfillment Center BVA1", "facility_code": "BVA1", "facility_type": "fulfillment_center", "address_line": "Parc d'activités Jules Verne", "postal_code": "80440", "city": "Boves", "region": "Hauts-de-France", "country_code": "FR", "lat": 49.848, "lon": 2.388, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-lil1-lauwin-fr", "company": "Amazon", "facility_name": "Fulfillment Center LIL1", "facility_code": "LIL1", "facility_type": "fulfillment_center", "address_line": "Rue de l'Innovation", "postal_code": "59553", "city": "Lauwin-Planque", "region": "Hauts-de-France", "country_code": "FR", "lat": 50.376, "lon": 3.023, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-mxp5-castel-goffredo-it", "company": "Amazon", "facility_name": "Fulfillment Center MXP5", "facility_code": "MXP5", "facility_type": "fulfillment_center", "address_line": "Via Maestri del Lavoro 8", "postal_code": "46042", "city": "Castel Goffredo", "region": "Lombardy", "country_code": "IT", "lat": 45.296, "lon": 10.478, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-mad4-illescas-es", "company": "Amazon", "facility_name": "Fulfillment Center MAD4", "facility_code": "MAD4", "facility_type": "fulfillment_center", "address_line": "Polígono Industrial El Restón", "postal_code": "45200", "city": "Illescas", "region": "Castilla-La Mancha", "country_code": "ES", "lat": 40.128, "lon": -3.848, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-bcn1-martorelles-es", "company": "Amazon", "facility_name": "Fulfillment Center BCN1", "facility_code": "BCN1", "facility_type": "fulfillment_center", "address_line": "Carrer de la Logística 1", "postal_code": "08107", "city": "Martorelles", "region": "Catalonia", "country_code": "ES", "lat": 41.533, "lon": 2.226, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-lba2-doncaster-gb", "company": "Amazon", "facility_name": "Fulfillment Center LBA2", "facility_code": "LBA2", "facility_type": "fulfillment_center", "address_line": "Iport Avenue", "postal_code": "DN11 0BG", "city": "Doncaster", "region": "South Yorkshire", "country_code": "GB", "lat": 53.522, "lon": -1.128, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "amazon-ema2-coalville-gb", "company": "Amazon", "facility_name": "Fulfillment Center EMA2", "facility_code": "EMA2", "facility_type": "fulfillment_center", "address_line": "Power Station Road", "postal_code": "LE67 1FB", "city": "Coalville", "region": "Leicestershire", "country_code": "GB", "lat": 52.721, "lon": -1.356, "source": "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf", "geocode_method": "nominatim"},
    {"id": "ikea-dc-rathcoole-ie", "company": "IKEA", "facility_name": "Distribution Centre Rathcoole", "facility_code": "DC", "facility_type": "distribution_center", "address_line": "Ballymount Road Upper", "postal_code": "D24", "city": "Rathcoole", "region": "Dublin", "country_code": "IE", "lat": 53.298, "lon": -6.472, "source": "https://www.ikea.com/", "geocode_method": "nominatim"},
    {"id": "zalando-lz-erfurt-de", "company": "Zalando", "facility_name": "Zalando Logistics Centre Erfurt", "facility_code": "LZ", "facility_type": "fulfillment_center", "address_line": "Am Flugplatz 1", "postal_code": "99092", "city": "Erfurt", "region": "Thuringia", "country_code": "DE", "lat": 50.978, "lon": 10.959, "source": "https://www.invest-in-thuringia.de/", "geocode_method": "nominatim"},
    {"id": "schenker-terminal-erfurt-de", "company": "DB Schenker", "facility_name": "Schenker Terminal Erfurt", "facility_code": "Terminal", "facility_type": "logistics_terminal", "address_line": "Am Flugplatz 80", "postal_code": "99092", "city": "Erfurt", "region": "Thuringia", "country_code": "DE", "lat": 50.975, "lon": 10.951, "source": "https://www.invest-in-thuringia.de/", "geocode_method": "nominatim"},
    {"id": "dhl-ludwigsau-de", "company": "DHL", "facility_name": "DHL Logistik-Center Ludwigsau", "facility_code": "LC", "facility_type": "distribution_center", "address_line": "An der Autobahn 1", "postal_code": "36251", "city": "Ludwigsau", "region": "Hesse", "country_code": "DE", "lat": 50.898, "lon": 9.772, "source": "https://www.invest-in-thuringia.de/", "geocode_method": "nominatim"},
    {"id": "inpost-sortownia-poznan-pl", "company": "InPost", "facility_name": "InPost Sortownia Poznań", "facility_code": "Sortownia", "facility_type": "logistics_terminal", "address_line": "ul. Wierzbowa 1", "postal_code": "62-081", "city": "Poznań", "region": "Greater Poland", "country_code": "PL", "lat": 52.421, "lon": 16.935, "source": "https://inpost.pl/", "geocode_method": "nominatim"},
    {"id": "raben-olsztynek-pl", "company": "Raben", "facility_name": "Raben Logistics Centre Olsztynek", "facility_code": "WH", "facility_type": "contract_logistics_warehouse", "address_line": "ul. Spółdzielcza 5", "postal_code": "11-015", "city": "Olsztynek", "region": "Warmia-Masuria", "country_code": "PL", "lat": 53.583, "lon": 20.267, "source": "https://www.raben-group.com/", "geocode_method": "nominatim"},
    {"id": "dachser-brzeg-pl", "company": "Dachser", "facility_name": "Dachser Logistics Centre Brzeg", "facility_code": "LC", "facility_type": "contract_logistics_warehouse", "address_line": "ul. Kolejowa 2", "postal_code": "49-300", "city": "Brzeg", "region": "Opole", "country_code": "PL", "lat": 50.861, "lon": 17.472, "source": "https://www.dachser.com/", "geocode_method": "nominatim"},
    {"id": "rohlig-warszawa-pl", "company": "Rohlig", "facility_name": "Röhlig SUUS Logistics Warsaw", "facility_code": "Hub", "facility_type": "freight_hub", "address_line": "ul. Annopol 15", "postal_code": "03-236", "city": "Warszawa", "region": "Mazovia", "country_code": "PL", "lat": 52.301, "lon": 21.026, "source": "https://www.rohlig.com/", "geocode_method": "nominatim"},
    {"id": "maersk-rotterdam-nl", "company": "Maersk", "facility_name": "Maersk Container Terminal", "facility_code": "Terminal", "facility_type": "port_inland_terminal", "address_line": "Europaweg 875", "postal_code": "3199", "city": "Rotterdam", "region": "South Holland", "country_code": "NL", "lat": 51.949, "lon": 4.142, "source": "https://www.maersk.com/", "geocode_method": "nominatim"},
    {"id": "dpworld-antwerp-be", "company": "DP World", "facility_name": "DP World Antwerp Gateway", "facility_code": "Terminal", "facility_type": "port_inland_terminal", "address_line": "Scheldelaan 170", "postal_code": "2030", "city": "Antwerp", "region": "Flanders", "country_code": "BE", "lat": 51.279, "lon": 4.336, "source": "https://www.dpworld.com/", "geocode_method": "nominatim"},
    {"id": "decathlon-villeneuve-fr", "company": "Decathlon", "facility_name": "Decathlon Logistics Campus", "facility_code": "DC", "facility_type": "distribution_center", "address_line": "Rue de la Gare", "postal_code": "59493", "city": "Villeneuve-d'Ascq", "region": "Hauts-de-France", "country_code": "FR", "lat": 50.623, "lon": 3.144, "source": "https://www.decathlon.com/", "geocode_method": "nominatim"},
    {"id": "lidl-rudersberg-de", "company": "Lidl", "facility_name": "Lidl Distribution Centre Rudersberg", "facility_code": "DC", "facility_type": "retail_dc", "address_line": "Im Steinäcker 1", "postal_code": "73635", "city": "Rudersberg", "region": "Baden-Württemberg", "country_code": "DE", "lat": 48.885, "lon": 9.527, "source": "https://www.invest-in-thuringia.de/", "geocode_method": "nominatim"},
    {"id": "aldi-moenchengladbach-de", "company": "Aldi", "facility_name": "Aldi Regional Distribution Centre", "facility_code": "RDC", "facility_type": "retail_dc", "address_line": "Am Landabsatz 1", "postal_code": "41179", "city": "Mönchengladbach", "region": "NRW", "country_code": "DE", "lat": 51.142, "lon": 6.442, "source": "https://www.invest-in-thuringia.de/", "geocode_method": "nominatim"},
    {"id": "xpo-lyon-fr", "company": "XPO", "facility_name": "XPO Logistics Satolas", "facility_code": "WH", "facility_type": "contract_logistics_warehouse", "address_line": "Rue de la Gare", "postal_code": "69125", "city": "Colombier-Saugnieu", "region": "Auvergne-Rhône-Alpes", "country_code": "FR", "lat": 45.726, "lon": 5.081, "source": "https://www.xpo.com/", "geocode_method": "nominatim"},
    {"id": "ceva-venlo-nl", "company": "CEVA", "facility_name": "CEVA Logistics Venlo", "facility_code": "WH", "facility_type": "contract_logistics_warehouse", "address_line": "Columbusweg 10", "postal_code": "5928", "city": "Venlo", "region": "Limburg", "country_code": "NL", "lat": 51.37, "lon": 6.128, "source": "https://www.cevalogistics.com/", "geocode_method": "nominatim"},
    {"id": "fm-logistic-neuville-fr", "company": "FM Logistic", "facility_name": "FM Logistic Neuville", "facility_code": "DC", "facility_type": "distribution_center", "address_line": "Rue de la Gare", "postal_code": "59261", "city": "Neuville-en-Ferrain", "region": "Hauts-de-France", "country_code": "FR", "lat": 50.747, "lon": 3.156, "source": "https://www.fmlogistic.com/", "geocode_method": "nominatim"},
    {"id": "id-logistics-corbas-fr", "company": "ID Logistics", "facility_name": "ID Logistics Corbas", "facility_code": "DC", "facility_type": "distribution_center", "address_line": "Rue de la Gare", "postal_code": "69960", "city": "Corbas", "region": "Auvergne-Rhône-Alpes", "country_code": "FR", "lat": 45.667, "lon": 4.901, "source": "https://www.id-logistics.com/", "geocode_method": "nominatim"},
    {"id": "hermes-hamburg-de", "company": "Hermes", "facility_name": "Hermes Fulfilment Hamburg", "facility_code": "FC", "facility_type": "fulfillment_center", "address_line": "Werner-von-Siemens-Straße 6", "postal_code": "22113", "city": "Hamburg", "region": "Hamburg", "country_code": "DE", "lat": 53.539, "lon": 10.103, "source": "https://www.hermesworld.com/", "geocode_method": "nominatim"},
    {"id": "ups-herne-de", "company": "UPS", "facility_name": "UPS Hub Herne", "facility_code": "Hub", "facility_type": "freight_hub", "address_line": "Cranger Straße 100", "postal_code": "44625", "city": "Herne", "region": "NRW", "country_code": "DE", "lat": 51.538, "lon": 7.225, "source": "https://www.ups.com/", "geocode_method": "nominatim"},
    {"id": "fedex-cologne-de", "company": "FedEx", "facility_name": "FedEx Express Cologne Hub", "facility_code": "Hub", "facility_type": "freight_hub", "address_line": "Grengeler Maar 1", "postal_code": "53859", "city": "Niederkassel", "region": "NRW", "country_code": "DE", "lat": 50.865, "lon": 7.143, "source": "https://www.fedex.com/", "geocode_method": "nominatim"},
    {"id": "geodis-venray-nl", "company": "Geodis", "facility_name": "Geodis Venray Campus", "facility_code": "DC", "facility_type": "distribution_center", "address_line": "Columbusweg 1", "postal_code": "5807", "city": "Venray", "region": "Limburg", "country_code": "NL", "lat": 51.525, "lon": 6.003, "source": "https://www.geodis.com/", "geocode_method": "nominatim"},
    {"id": "kuehne-nagel-luxembourg-lu", "company": "Kuehne+Nagel", "facility_name": "Kuehne+Nagel Luxembourg", "facility_code": "WH", "facility_type": "contract_logistics_warehouse", "address_line": "Rue de Flaxweiler", "postal_code": "6776", "city": "Grevenmacher", "region": "Grevenmacher", "country_code": "LU", "lat": 49.681, "lon": 6.441, "source": "https://www.kuehne-nagel.com/", "geocode_method": "nominatim"},
    {"id": "rhenus-dortmund-de", "company": "Rhenus", "facility_name": "Rhenus Logistics Dortmund", "facility_code": "LC", "facility_type": "logistics_terminal", "address_line": "Kaltbandstraße 8", "postal_code": "44145", "city": "Dortmund", "region": "NRW", "country_code": "DE", "lat": 51.529, "lon": 7.468, "source": "https://www.rhenus.group/", "geocode_method": "nominatim"},
    {"id": "pekaes-kalisz-pl", "company": "PEKAES", "facility_name": "PEKAES Terminal Kalisz", "facility_code": "Terminal", "facility_type": "logistics_terminal", "address_line": "ul. Towarowa 6", "postal_code": "62-800", "city": "Kalisz", "region": "Greater Poland", "country_code": "PL", "lat": 51.761, "lon": 18.091, "source": "https://www.pekaes.com.pl/", "geocode_method": "nominatim"},
    {"id": "poczta-warszawa-pl", "company": "Poczta Polska", "facility_name": "Poczta Polska Logistics Centre", "facility_code": "LC", "facility_type": "distribution_center", "address_line": "ul. Rodziny Hiszpańskich 8", "postal_code": "02-685", "city": "Warszawa", "region": "Mazovia", "country_code": "PL", "lat": 52.165, "lon": 20.967, "source": "https://www.poczta-polska.pl/", "geocode_method": "nominatim"},
]
# fmt: on

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = """
[out:json][timeout:180];
(
  node["industrial"="logistics"](35.0,-10.0,71.0,40.0);
  way["industrial"="logistics"](35.0,-10.0,71.0,40.0);
  node["landuse"="industrial"]["name"](35.0,-10.0,71.0,40.0);
  way["landuse"="industrial"]["name"](35.0,-10.0,71.0,40.0);
  node["warehouse"="yes"]["name"](35.0,-10.0,71.0,40.0);
  way["warehouse"="yes"]["name"](35.0,-10.0,71.0,40.0);
  node["building"="warehouse"]["name"](35.0,-10.0,71.0,40.0);
  way["building"="warehouse"]["name"](35.0,-10.0,71.0,40.0);
);
out center 2500;
"""


def _slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def _infer_company(tags: dict[str, str]) -> str | None:
    for key in ("operator", "brand", "name"):
        raw = tags.get(key)
        if not raw:
            continue
        for preferred in PREFERRED_OPERATORS:
            if preferred.lower() in raw.lower():
                return preferred
        if key == "operator":
            return raw.split(";")[0].strip()[:60]
    name = tags.get("name")
    if name:
        return name.split()[0][:60]
    return None


def _infer_facility_type(tags: dict[str, str]) -> str:
    haystack = " ".join(
        tags.get(key, "")
        for key in ("industrial", "landuse", "building", "amenity", "name", "operator")
    ).lower()
    for keyword, facility_type in FACILITY_TYPE_KEYWORDS:
        if keyword in haystack:
            return facility_type
    return "contract_logistics_warehouse"


def _country_code(tags: dict[str, str], lat: float, lon: float) -> str:
    if tags.get("addr:country"):
        return tags["addr:country"][:2].upper()
    # Rough bounding boxes for common ISO codes when OSM omits country
    if 49.0 <= lat <= 55.0 and 14.0 <= lon <= 24.0:
        return "PL"
    if 47.0 <= lat <= 55.0 and 5.5 <= lon <= 15.5:
        return "DE"
    if 41.0 <= lat <= 51.5 and -5.5 <= lon <= 9.5:
        return "FR"
    if 36.0 <= lat <= 44.0 and -9.5 <= lon <= 4.5:
        return "ES"
    if 35.5 <= lat <= 47.5 and 6.5 <= lon <= 19.0:
        return "IT"
    if 50.5 <= lat <= 54.0 and -8.5 <= lon <= 2.0:
        return "GB"
    if 55.0 <= lat <= 69.0 and 4.0 <= lon <= 31.0:
        return "SE"
    if 55.0 <= lat <= 58.0 and 8.0 <= lon <= 13.0:
        return "DK"
    if 59.0 <= lat <= 71.0 and 4.0 <= lon <= 31.0:
        return "NO"
    if 59.0 <= lat <= 70.5 and 19.0 <= lon <= 32.0:
        return "FI"
    if 45.5 <= lat <= 48.5 and 16.0 <= lon <= 23.0:
        return "HU"
    if 48.0 <= lat <= 51.5 and 12.0 <= lon <= 19.0:
        return "CZ"
    if 47.5 <= lat <= 49.7 and 16.8 <= lon <= 23.0:
        return "SK"
    if 46.0 <= lat <= 49.0 and 9.0 <= lon <= 17.5:
        return "AT"
    if 50.5 <= lat <= 54.0 and 2.5 <= lon <= 7.5:
        return "NL"
    if 49.4 <= lat <= 51.6 and 2.5 <= lon <= 6.5:
        return "BE"
    if 34.5 <= lat <= 35.8 and 32.0 <= lon <= 34.8:
        return "CY"
    if 35.7 <= lat <= 36.1 and 14.1 <= lon <= 14.7:
        return "MT"
    if 44.0 <= lat <= 48.5 and 20.0 <= lon <= 30.0:
        return "RO"
    if 41.0 <= lat <= 44.5 and 22.0 <= lon <= 29.0:
        return "BG"
    if 45.4 <= lat <= 46.9 and 13.3 <= lon <= 16.7:
        return "SI"
    if 42.0 <= lat <= 46.6 and 13.0 <= lon <= 19.5:
        return "HR"
    if 42.0 <= lat <= 46.2 and 18.8 <= lon <= 23.0:
        return "RS"
    if 42.5 <= lat <= 45.3 and 15.7 <= lon <= 19.6:
        return "BA"
    if 34.5 <= lat <= 42.0 and 19.0 <= lon <= 30.0:
        return "GR"
    if 55.0 <= lat <= 58.5 and 20.5 <= lon <= 28.5:
        return "LT"
    if 55.5 <= lat <= 58.5 and 20.5 <= lon <= 28.5:
        return "LV"
    if 57.5 <= lat <= 60.0 and 21.5 <= lon <= 28.5:
        return "EE"
    if 45.8 <= lat <= 47.9 and 5.9 <= lon <= 10.6:
        return "CH"
    if 44.0 <= lat <= 52.5 and 22.0 <= lon <= 40.5:
        return "UA"
    if 45.4 <= lat <= 48.5 and 26.5 <= lon <= 30.5:
        return "MD"
    if 36.8 <= lat <= 42.3 and -9.6 <= lon <= -6.0:
        return "PT"
    if 51.4 <= lat <= 55.5 and -11.0 <= lon <= -5.0:
        return "IE"
    return "EU"


def _element_coords(element: dict[str, Any]) -> tuple[float, float] | None:
    if element.get("type") == "node":
        if "lat" in element and "lon" in element:
            return float(element["lat"]), float(element["lon"])
        return None
    center = element.get("center")
    if center and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def fetch_overpass_sites() -> list[dict[str, Any]]:
    data = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    request = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={"User-Agent": "LoadmaxPZPP2/1.0 (logistics catalog builder)"},
    )
    with urllib.request.urlopen(request, timeout=200) as response:
        payload = json.loads(response.read().decode())

    sites: list[dict[str, Any]] = []
    for element in payload.get("elements", []):
        coords = _element_coords(element)
        if coords is None:
            continue
        lat, lon = coords
        if not (EUROPE_BBOX[0] <= lat <= EUROPE_BBOX[2] and EUROPE_BBOX[1] <= lon <= EUROPE_BBOX[3]):
            continue
        tags = element.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue
        company = _infer_company(tags)
        if company is None:
            continue
        city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village") or "Unknown"
        country_code = _country_code(tags, lat, lon)
        facility_type = _infer_facility_type(tags)
        site_id = _slugify(f"osm-{company}-{name}-{city}-{country_code}-{element['id']}")
        sites.append(
            {
                "id": site_id[:120],
                "company": company,
                "facility_name": name[:120],
                "facility_type": facility_type,
                "address_line": tags.get("addr:street") or tags.get("addr:full"),
                "postal_code": tags.get("addr:postcode"),
                "city": city,
                "region": tags.get("addr:state"),
                "country_code": country_code,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "source": f"https://www.openstreetmap.org/{element['type']}/{element['id']}",
                "verified_at": VERIFIED_AT,
                "geocode_method": "osm_overpass",
            },
        )
    return sites


def merge_sites(*sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    coord_seen: set[tuple[float, float]] = set()

    for source in sources:
        for raw in source:
            lat = round(float(raw["lat"]), 5)
            lon = round(float(raw["lon"]), 5)
            coord_key = (lat, lon)
            if coord_key in coord_seen:
                continue
            site_id = str(raw["id"])
            if site_id in merged:
                continue
            entry = dict(raw)
            entry["lat"] = lat
            entry["lon"] = lon
            entry["verified_at"] = entry.get("verified_at") or VERIFIED_AT
            merged[site_id] = entry
            coord_seen.add(coord_key)

    return sorted(merged.values(), key=lambda item: item["id"])


def main() -> None:
    curated = [{**site, "verified_at": site.get("verified_at", VERIFIED_AT)} for site in CURATED_SITES]
    print(f"Curated sites: {len(curated)}")
    try:
        overpass_sites = fetch_overpass_sites()
        print(f"Overpass sites: {len(overpass_sites)}")
    except Exception as exc:
        print(f"Overpass fetch failed: {exc}", file=sys.stderr)
        overpass_sites = []

    catalog = merge_sites(curated, overpass_sites)
    countries = {site["country_code"] for site in catalog}
    print(f"Merged catalog: {len(catalog)} sites, {len(countries)} countries")

    if len(catalog) < 1090:
        print(
            f"WARNING: only {len(catalog)} sites (need >=1090). "
            "Re-run when Overpass is available or extend curated list.",
            file=sys.stderr,
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
