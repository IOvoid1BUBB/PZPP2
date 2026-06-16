#!/usr/bin/env python3
"""One-off: geocode curated sites and write _embedded_sites_seed.json."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "_embedded_sites_seed.json"

# [id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code]
SITES = [
    # Amazon DE (Amazon EU PDF / Sellerlogic)
    ["amazon-ber3-brieselang-de", "Amazon", "Fulfillment Center BER3", "BER3", "fulfillment_center", "Havellandstr. 5", "14656", "Brieselang", "DE"],
    ["amazon-ber6-berlin-de", "Amazon", "Fulfillment Center BER6", "BER6", "fulfillment_center", "Am Borsigturm 100", "13507", "Berlin", "DE"],
    ["amazon-ber8-schoenefeld-de", "Amazon", "Fulfillment Center BER8", "BER8", "fulfillment_center", "Am Möllenpfuhl 2", "12529", "Schönefeld", "DE"],
    ["amazon-cgn1-kobern-gondorf-de", "Amazon", "Fulfillment Center CGN1", "CGN1", "fulfillment_center", "Amazonstrasse 1", "56330", "Kobern-Gondorf", "DE"],
    ["amazon-dtm1-werne-de", "Amazon", "Fulfillment Center DTM1", "DTM1", "fulfillment_center", "Carl-Zeiss-Straße 3", "59368", "Werne", "DE"],
    ["amazon-dtm2-dortmund-de", "Amazon", "Fulfillment Center DTM2", "DTM2", "fulfillment_center", "Kaltbandstraße 4", "44145", "Dortmund", "DE"],
    ["amazon-dus2-rheinberg-de", "Amazon", "Fulfillment Center DUS2", "DUS2", "fulfillment_center", "Amazonstrasse 1", "47495", "Rheinberg", "DE"],
    ["amazon-fra1-bad-hersfeld-de", "Amazon", "Fulfillment Center FRA1", "FRA1", "fulfillment_center", "Am Schloss Eichhof 1", "36251", "Bad Hersfeld", "DE"],
    ["amazon-fra3-bad-hersfeld-de", "Amazon", "Fulfillment Center FRA3", "FRA3", "fulfillment_center", "Amazonstrasse 1", "36251", "Bad Hersfeld", "DE"],
    ["amazon-ham2-winsen-de", "Amazon", "Fulfillment Center HAM2", "HAM2", "fulfillment_center", "Borgwardstrasse 10", "21423", "Winsen", "DE"],
    ["amazon-lej1-leipzig-de", "Amazon", "Fulfillment Center LEJ1", "LEJ1", "fulfillment_center", "Amazonstrasse 1", "04347", "Leipzig", "DE"],
    ["amazon-muc3-graben-de", "Amazon", "Fulfillment Center MUC3", "MUC3", "fulfillment_center", "Amazonstrasse 1", "86836", "Graben", "DE"],
    ["amazon-str1-pforzheim-de", "Amazon", "Fulfillment Center STR1", "STR1", "fulfillment_center", "Amazonstrasse 1", "75177", "Pforzheim", "DE"],
    # Amazon PL
    ["amazon-ktw1-sosnowiec-pl", "Amazon", "Fulfillment Center KTW1", "KTW1", "fulfillment_center", "ul. Inwestycyjna 19", "41-208", "Sosnowiec", "PL"],
    ["amazon-poz1-sady-pl", "Amazon", "Fulfillment Center POZ1", "POZ1", "fulfillment_center", "ul. Poznańska 1d", "62-080", "Sady", "PL"],
    ["amazon-szz1-kolbaskowo-pl", "Amazon", "Fulfillment Center SZZ1", "SZZ1", "fulfillment_center", "Kolbaskowo 156", "72-001", "Kolbaskowo", "PL"],
    ["amazon-wro1-bielany-pl", "Amazon", "Fulfillment Center WRO1", "WRO1", "fulfillment_center", "ul. Czekoladowa 1", "55-040", "Bielany Wrocławskie", "PL"],
    ["amazon-wro2-bielany-pl", "Amazon", "Fulfillment Center WRO2", "WRO2", "fulfillment_center", "ul. Logistyczna 6", "55-040", "Bielany Wrocławskie", "PL"],
    # Amazon FR
    ["amazon-bva1-boves-fr", "Amazon", "Fulfillment Center BVA1", "BVA1", "fulfillment_center", "7 Rue des Indes Noires", "80440", "Boves", "FR"],
    ["amazon-lil1-lauwin-planque-fr", "Amazon", "Fulfillment Center LIL1", "LIL1", "fulfillment_center", "1 rue Amazon", "59553", "Lauwin-Planque", "FR"],
    ["amazon-lys1-sevrey-fr", "Amazon", "Fulfillment Center LYS1", "LYS1", "fulfillment_center", "1 rue Amazon", "71311", "Sevrey", "FR"],
    ["amazon-mrs1-montelimar-fr", "Amazon", "Fulfillment Center MRS1", "MRS1", "fulfillment_center", "Rue Joseph Garde", "26200", "Montélimar", "FR"],
    ["amazon-ory1-saran-fr", "Amazon", "Fulfillment Center ORY1", "ORY1", "fulfillment_center", "1401 rue du Champ Rouge", "45770", "Saran", "FR"],
    # Amazon GB
    ["amazon-bhx1-rugeley-gb", "Amazon", "Fulfillment Center BHX1", "BHX1", "fulfillment_center", "Power Station Road", "WS15 1NZ", "Rugeley", "GB"],
    ["amazon-bhx3-daventry-gb", "Amazon", "Fulfillment Center BHX3", "BHX3", "fulfillment_center", "Royal Oak Way North", "NN11 8QL", "Daventry", "GB"],
    ["amazon-edi4-dunfermline-gb", "Amazon", "Fulfillment Center EDI4", "EDI4", "fulfillment_center", "Amazon Way", "KY11 8XT", "Dunfermline", "GB"],
    ["amazon-lba2-doncaster-gb", "Amazon", "Fulfillment Center LBA2", "LBA2", "fulfillment_center", "Iport Avenue", "DN11 0BG", "Doncaster", "GB"],
    ["amazon-ltn1-ridgmont-gb", "Amazon", "Fulfillment Center LTN1", "LTN1", "fulfillment_center", "Marston Gate", "MK43 0ZA", "Ridgmont", "GB"],
    ["amazon-man1-manchester-gb", "Amazon", "Fulfillment Center MAN1", "MAN1", "fulfillment_center", "6 Sunbank Lane", "M90 5AA", "Manchester", "GB"],
    # Amazon ES
    ["amazon-bcn1-el-prat-es", "Amazon", "Fulfillment Center BCN1", "BCN1", "fulfillment_center", "Avinguda de les Garrigues 6-8", "08820", "El Prat de Llobregat", "ES"],
    ["amazon-bcn3-castellbisbal-es", "Amazon", "Fulfillment Center BCN3", "BCN3", "fulfillment_center", "Carrer Ferro 12", "08755", "Castellbisbal", "ES"],
    ["amazon-mad4-san-fernando-es", "Amazon", "Fulfillment Center MAD4", "MAD4", "fulfillment_center", "Avenida de Astronomía 24", "28830", "San Fernando de Henares", "ES"],
    # Amazon IT
    ["amazon-fco1-passo-corese-it", "Amazon", "Fulfillment Center FCO1", "FCO1", "fulfillment_center", "Via della Meccanica 4", "02032", "Passo Corese", "IT"],
    ["amazon-mxp3-vercelli-it", "Amazon", "Fulfillment Center MXP3", "MXP3", "fulfillment_center", "Via Rita Levi Montalcini 2", "13100", "Vercelli", "IT"],
    ["amazon-mxp5-castel-san-giovanni-it", "Amazon", "Fulfillment Center MXP5", "MXP5", "fulfillment_center", "Strada Dogana Po 2U", "29015", "Castel San Giovanni", "IT"],
    # Amazon CZ / SK / BE
    ["amazon-prg2-dobroviz-cz", "Amazon", "Fulfillment Center PRG2", "PRG2", "fulfillment_center", "K Amazonu 235", "25261", "Dobrovíz", "CZ"],
    ["amazon-bts2-sered-sk", "Amazon", "Fulfillment Center BTS2", "BTS2", "fulfillment_center", None, "926 01", "Sereď", "SK"],
    ["amazon-dbg2-antwerp-be", "Amazon", "Fulfillment Center DBG2", "DBG2", "fulfillment_center", "D'Herbouvillekaai 70", "2020", "Antwerp", "BE"],
    # Amazon IE
    ["amazon-snn4-dublin-ie", "Amazon", "Fulfillment Center SNN4", "SNN4", "fulfillment_center", "Baldonnell Business Park", "D22", "Dublin", "IE"],
    # IKEA DCs
    ["ikea-dc-delft-nl", "IKEA", "Distribution Centre Delft", "DC-DEL", "distribution_center", "Laan van Haagvliet 2", "2614", "Delft", "NL"],
    ["ikea-dc-duisburg-de", "IKEA", "Distribution Centre Duisburg", "DC-DUI", "distribution_center", "Am Schlütershof 30", "47059", "Duisburg", "DE"],
    ["ikea-dc-malmoe-se", "IKEA", "Distribution Centre Malmö", "DC-MMA", "distribution_center", "Fosievägen 7", "21431", "Malmö", "SE"],
    ["ikea-dc-rathcoole-ie", "IKEA", "Distribution Centre Rathcoole", "DC-RAT", "distribution_center", "Ballymount Road Upper", "D24", "Rathcoole", "IE"],
    ["ikea-dc-wroclaw-pl", "IKEA", "Distribution Centre Wrocław", "DC-WRO", "distribution_center", "ul. Magazynowa 1", "55-040", "Bielany Wrocławskie", "PL"],
    ["ikea-dc-vienna-at", "IKEA", "Distribution Centre Vienna", "DC-VIE", "distribution_center", "Logistikpark 1", "2333", "Leopoldsdorf", "AT"],
    # DHL / Schenker
    ["dhl-ludwigsau-de", "DHL", "Logistik-Center Ludwigsau", "LC-LUD", "distribution_center", "Im Fuldatal 2", "36251", "Ludwigsau", "DE"],
    ["dhl-leipzig-de", "DHL", "DHL Hub Leipzig", "HUB-LEJ", "logistics_terminal", "Hans-Wittwer-Straße 6", "04435", "Schkeuditz", "DE"],
    ["dhl-budapest-hu", "DHL", "DHL Freight Terminal Budapest", "BUD-FT", "logistics_terminal", "Gyáli út 43", "1097", "Budapest", "HU"],
    ["db-schenker-hamburg-de", "DB Schenker", "Schenker Terminal Hamburg", "HAM-T", "logistics_terminal", "Waltershofer Damm 26", "21129", "Hamburg", "DE"],
    ["db-schenker-vienna-at", "DB Schenker", "Schenker Terminal Vienna", "VIE-T", "logistics_terminal", "Logistikpark 15", "2333", "Leopoldsdorf", "AT"],
    ["db-schenker-prague-cz", "DB Schenker", "Schenker Terminal Prague", "PRG-T", "logistics_terminal", "Ke Kopanině 421", "252 62", "Horoměřice", "CZ"],
    ["db-schenker-bucharest-ro", "DB Schenker", "Schenker Terminal Bucharest", "BUH-T", "logistics_terminal", "Șoseaua București-Ploiești 42", "013696", "Bucharest", "RO"],
    # InPost PL
    ["inpost-sortownia-poznan-pl", "InPost", "Sortownia Poznań", "POZ-S", "logistics_terminal", "ul. Wierzbowa 1", "62-081", "Przeźmierowo", "PL"],
    ["inpost-sortownia-wroclaw-pl", "InPost", "Sortownia Wrocław", "WRO-S", "logistics_terminal", "ul. Magazynowa 2", "55-040", "Bielany Wrocławskie", "PL"],
    ["inpost-sortownia-krakow-pl", "InPost", "Sortownia Kraków", "KRK-S", "logistics_terminal", "ul. Jasnogórska 9", "31-358", "Kraków", "PL"],
    # Raben
    ["raben-otwock-pl", "Raben Group", "Raben Logistics Centre Otwock", "OTW", "distribution_center", "ul. Kraszewskiego 1", "05-400", "Otwock", "PL"],
    ["raben-venlo-nl", "Raben Group", "Raben Cross Dock Venlo", "VEN", "logistics_terminal", "Transportweg 4", "5928", "Venlo", "NL"],
    ["raben-budapest-hu", "Raben Group", "Raben Logistics Centre Budapest", "BUD", "distribution_center", "Gyáli út 17", "1097", "Budapest", "HU"],
    ["raben-brno-cz", "Raben Group", "Raben Logistics Centre Brno", "BRQ", "distribution_center", "Tuřanka 1519/115a", "627 00", "Brno", "CZ"],
    # Port / inland terminals NL BE LU
    ["maersk-rotterdam-nl", "Maersk", "APM Terminals Rotterdam", "RTM", "port_inland_terminal", "Europaweg 875", "3199", "Maasvlakte", "NL"],
    ["dpworld-antwerp-be", "DP World", "Antwerp Gateway", "ANR", "port_inland_terminal", "Scheldelaan 170", "2030", "Antwerp", "BE"],
    ["cargolux-findel-lu", "Cargolux", "Cargolux Hub Findel", "LUX", "logistics_terminal", "L-2990", "L-2990", "Findel", "LU"],
    # Nordics
    ["postnord-kista-se", "PostNord", "Terminal Kista", "KIS", "logistics_terminal", "Finspångsgatan 54", "16474", "Kista", "SE"],
    ["postnord-albertslund-dk", "PostNord", "Terminal Albertslund", "ALB", "logistics_terminal", "Herstedvang 7A", "2620", "Albertslund", "DK"],
    ["posti-helsinki-fi", "Posti", "Logistics Centre Helsinki", "HEL", "logistics_terminal", "Pansio", "20240", "Turku", "FI"],
    ["bring-oslo-no", "Bring", "Terminal Oslo", "OSL", "logistics_terminal", "Lindebergveien 10", "1068", "Oslo", "NO"],
    # Baltics
    ["dhl-riga-lv", "DHL", "DHL Freight Riga", "RIX", "logistics_terminal", "Daugavgrīvas iela 106", "LV-1016", "Riga", "LV"],
    ["dhl-vilnius-lt", "DHL", "DHL Freight Vilnius", "VNO", "logistics_terminal", "Ozo g. 12A", "LT-08200", "Vilnius", "LT"],
    ["omniva-tallinn-ee", "Omniva", "Logistics Centre Tallinn", "TLL", "logistics_terminal", "Peterburi tee 81", "11415", "Tallinn", "EE"],
    # Southern / Eastern Europe
    ["dhl-athens-gr", "DHL", "DHL Hub Athens", "ATH", "logistics_terminal", "Attiki Odos 62", "190 02", "Paiania", "GR"],
    ["dhl-lisbon-pt", "DHL", "DHL Terminal Lisbon", "LIS", "logistics_terminal", "Rua C 2", "2685-888", "Prior Velho", "PT"],
    ["db-schenker-zagreb-hr", "DB Schenker", "Schenker Terminal Zagreb", "ZAG", "logistics_terminal", "Slavonska avenija 22", "10000", "Zagreb", "HR"],
    ["db-schenker-ljubljana-si", "DB Schenker", "Schenker Terminal Ljubljana", "LJU", "logistics_terminal", "Cesta v Gorice 35", "1000", "Ljubljana", "SI"],
    ["dhl-belgrade-rs", "DHL", "DHL Freight Belgrade", "BEG", "logistics_terminal", "Bulevar Vojvode Mišića 33", "11000", "Belgrade", "RS"],
    ["dhl-sarajevo-ba", "DHL", "DHL Express Sarajevo", "SJJ", "logistics_terminal", "Zmaja od Bosne 8", "71000", "Sarajevo", "BA"],
    ["novaposhta-kyiv-ua", "Nova Poshta", "Logistics Terminal Kyiv", "KBP", "logistics_terminal", "Pryluzhna 8", "02081", "Kyiv", "UA"],
    # Zalando / others DE
    ["zalando-lz-erfurt-de", "Zalando", "Logistics Centre Erfurt", "LZ-ERF", "fulfillment_center", "Am Flugplatz 1", "99092", "Erfurt", "DE"],
    ["hermes-loehne-de", "Hermes", "Fulfillment Centre Löhne", "LOE", "fulfillment_center", "Schillenbrink 4", "32584", "Löhne", "DE"],
    # Extra Amazon / operators for coverage
    ["amazon-lcy2-tilbury-gb", "Amazon", "Fulfillment Center LCY2", "LCY2", "fulfillment_center", "Windrush Road", "RM18 7AN", "Tilbury", "GB"],
    ["amazon-cwl1-swansea-gb", "Amazon", "Fulfillment Center CWL1", "CWL1", "fulfillment_center", "Ffordd Amazon", "SA1 8QX", "Swansea", "GB"],
    ["amazon-euk5-peterborough-gb", "Amazon", "Fulfillment Center EUK5", "EUK5", "fulfillment_center", "Flaxley Road", "PE2 9EN", "Peterborough", "GB"],
    ["amazon-bcn2-martorelles-es", "Amazon", "Fulfillment Center BCN2", "BCN2", "fulfillment_center", "Carrer de la Vernada 22", "08107", "Martorelles", "ES"],
    ["amazon-prg1-dobroviz-cz", "Amazon", "Fulfillment Center PRG1", "PRG1", "fulfillment_center", "U Trati 216", "25261", "Dobrovíz", "CZ"],
    ["dhl-euskirchen-de", "DHL", "DHL Solutions Euskirchen", "EUS", "distribution_center", "Barentsstrasse 24", "53881", "Euskirchen", "DE"],
    ["kuehne-nagel-rotterdam-nl", "Kuehne+Nagel", "KN Warehouse Rotterdam", "RTM-KN", "distribution_center", "Europaweg 2", "3199", "Rotterdam", "NL"],
    ["gls-utrecht-nl", "GLS", "GLS Depot Utrecht", "UTR", "logistics_terminal", "Herculesplein 100", "3584", "Utrecht", "NL"],
    ["chronopost-toulouse-fr", "Chronopost", "Hub Toulouse", "TLS", "logistics_terminal", "Rue du Languedoc", "31700", "Blagnac", "FR"],
    ["geodis-lyon-fr", "Geodis", "Geodis Hub Lyon", "LYS", "logistics_terminal", "Rue du Brisson 135", "38290", "Satolas-et-Bonce", "FR"],
    ["dhl-basel-ch", "DHL", "DHL Global Forwarding Basel", "BSL", "logistics_terminal", "Grünaustrasse 14", "4058", "Basel", "CH"],
    ["planzer-dietikon-ch", "Planzer", "Planzer Logistics Dietikon", "DIET", "distribution_center", "Grünaustrasse 2", "8953", "Dietikon", "CH"],
    ["dhl-bratislava-sk", "DHL", "DHL Freight Bratislava", "BTS", "logistics_terminal", "Galvaniho 15", "821 04", "Bratislava", "SK"],
    ["geis-prague-cz", "Geis", "Geis Logistics Prague", "PRG-G", "distribution_center", "Dopraváků 1023", "252 61", "Dobrovíz", "CZ"],
    ["dhl-cluj-ro", "DHL", "DHL Freight Cluj", "CLJ", "logistics_terminal", "Str. Fabricii de Zahăr 2", "400604", "Cluj-Napoca", "RO"],
    ["dhl-thessaloniki-gr", "DHL", "DHL Freight Thessaloniki", "SKG", "logistics_terminal", "26th Oktovriou 52", "54627", "Thessaloniki", "GR"],
    ["dhl-split-hr", "DHL", "DHL Express Split", "SPU", "logistics_terminal", "Vukovarska 207", "21000", "Split", "HR"],
    ["dhl-porto-pt", "DHL", "DHL Terminal Porto", "OPO", "logistics_terminal", "Rua Central de Cabeçudos", "4470", "Maia", "PT"],
    ["dhl-tallinn-ee", "DHL", "DHL Express Tallinn", "TLL-DHL", "logistics_terminal", "Peterburi tee 46", "11415", "Tallinn", "EE"],
    ["itella-helsinki-fi", "Itella Logistics", "Terminal Vantaa", "VAN", "logistics_terminal", "Rahtitie 1", "01530", "Vantaa", "FI"],
    ["postnord-bergen-no", "PostNord", "Terminal Bergen", "BGO", "logistics_terminal", "Fleslandvegen 200", "5258", "Blomsterdalen", "NO"],
    ["dhl-kaunas-lt", "DHL", "DHL Freight Kaunas", "KUN", "logistics_terminal", "Pramonės pr. 16", "LT-51329", "Kaunas", "LT"],
    ["dhl-riga-hub-lv", "DHL", "DHL Express Latvia", "RIX-DHL", "logistics_terminal", "Maskavas iela 240", "LV-1063", "Riga", "LV"],
    ["dhl-banja-luka-ba", "DHL", "DHL Banja Luka", "BNX", "logistics_terminal", "Bulevar srpske vojske 8", "78000", "Banja Luka", "BA"],
    ["meest-lviv-ua", "Meest", "Logistics Hub Lviv", "LWO", "logistics_terminal", "Stryiska 201", "79000", "Lviv", "UA"],
    ["dhl-luxembourg-lu", "DHL", "DHL Aviation Luxembourg", "LUX-DHL", "logistics_terminal", "Rue de Trèves", "L-2632", "Findel", "LU"],
]


def geocode(city, postal, country, address=None):
    parts = [p for p in [address, postal, city, country] if p]
    q = ", ".join(parts)
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": country.lower()}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "LoadmaxPZPP2-SeedBuilder/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    if not data:
        url2 = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": f"{postal} {city}, {country}", "format": "json", "limit": 1}
        )
        req2 = urllib.request.Request(url2, headers={"User-Agent": "LoadmaxPZPP2-SeedBuilder/1.0"})
        with urllib.request.urlopen(req2, timeout=30) as resp2:
            data = json.loads(resp2.read())
    if not data:
        raise RuntimeError(f"No result for {q}")
    return round(float(data[0]["lat"]), 5), round(float(data[0]["lon"]), 5)


def main():
    rows = []
    for i, site in enumerate(SITES):
        sid, company, fname, fcode, ftype, addr, pc, city, cc = site
        if i > 0:
            time.sleep(1.1)
        lat, lon = geocode(city, pc, cc, addr)
        rows.append([sid, company, fname, fcode, ftype, addr, pc, city, cc, lat, lon])
        print(f"{i+1}/{len(SITES)} {sid} -> {lat},{lon}")
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} entries to {OUT}")


if __name__ == "__main__":
    main()
