#!/usr/bin/env node
/** Geocode curated logistics sites via Nominatim → data/_embedded_sites_seed.json */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "_embedded_sites_seed.json");

const SITES = [
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
  ["amazon-ktw1-sosnowiec-pl", "Amazon", "Fulfillment Center KTW1", "KTW1", "fulfillment_center", "ul. Inwestycyjna 19", "41-208", "Sosnowiec", "PL"],
  ["amazon-poz1-sady-pl", "Amazon", "Fulfillment Center POZ1", "POZ1", "fulfillment_center", "ul. Poznańska 1d", "62-080", "Sady", "PL"],
  ["amazon-szz1-kolbaskowo-pl", "Amazon", "Fulfillment Center SZZ1", "SZZ1", "fulfillment_center", "Kolbaskowo 156", "72-001", "Kolbaskowo", "PL"],
  ["amazon-wro1-bielany-pl", "Amazon", "Fulfillment Center WRO1", "WRO1", "fulfillment_center", "ul. Czekoladowa 1", "55-040", "Bielany Wrocławskie", "PL"],
  ["amazon-bva1-boves-fr", "Amazon", "Fulfillment Center BVA1", "BVA1", "fulfillment_center", "7 Rue des Indes Noires", "80440", "Boves", "FR"],
  ["amazon-lil1-lauwin-planque-fr", "Amazon", "Fulfillment Center LIL1", "LIL1", "fulfillment_center", "1 rue Amazon", "59553", "Lauwin-Planque", "FR"],
  ["amazon-bhx1-rugeley-gb", "Amazon", "Fulfillment Center BHX1", "BHX1", "fulfillment_center", "Power Station Road", "WS15 1NZ", "Rugeley", "GB"],
  ["amazon-lba2-doncaster-gb", "Amazon", "Fulfillment Center LBA2", "LBA2", "fulfillment_center", "Iport Avenue", "DN11 0BG", "Doncaster", "GB"],
  ["amazon-mad4-san-fernando-es", "Amazon", "Fulfillment Center MAD4", "MAD4", "fulfillment_center", "Avenida de Astronomía 24", "28830", "San Fernando de Henares", "ES"],
  ["amazon-fco1-passo-corese-it", "Amazon", "Fulfillment Center FCO1", "FCO1", "fulfillment_center", "Via della Meccanica 4", "02032", "Passo Corese", "IT"],
  ["amazon-prg2-dobroviz-cz", "Amazon", "Fulfillment Center PRG2", "PRG2", "fulfillment_center", "K Amazonu 235", "25261", "Dobrovíz", "CZ"],
  ["amazon-snn4-dublin-ie", "Amazon", "Fulfillment Center SNN4", "SNN4", "fulfillment_center", "Baldonnell Business Park", "D22", "Dublin", "IE"],
  ["ikea-dc-rathcoole-ie", "IKEA", "Distribution Centre Rathcoole", "DC-RAT", "distribution_center", "Ballymount Road Upper", "D24", "Rathcoole", "IE"],
  ["ikea-dc-delft-nl", "IKEA", "Distribution Centre Delft", "DC-DEL", "distribution_center", "Laan van Haagvliet 2", "2614", "Delft", "NL"],
  ["dhl-ludwigsau-de", "DHL", "Logistik-Center Ludwigsau", "LC-LUD", "distribution_center", "Im Fuldatal 2", "36251", "Ludwigsau", "DE"],
  ["dhl-leipzig-de", "DHL", "DHL Hub Leipzig", "HUB-LEJ", "logistics_terminal", "Hans-Wittwer-Straße 6", "04435", "Schkeuditz", "DE"],
  ["db-schenker-hamburg-de", "DB Schenker", "Schenker Terminal Hamburg", "HAM-T", "logistics_terminal", "Waltershofer Damm 26", "21129", "Hamburg", "DE"],
  ["inpost-sortownia-poznan-pl", "InPost", "Sortownia Poznań", "POZ-S", "logistics_terminal", "ul. Wierzbowa 1", "62-081", "Przeźmierowo", "PL"],
  ["raben-venlo-nl", "Raben Group", "Raben Cross Dock Venlo", "VEN", "logistics_terminal", "Transportweg 4", "5928", "Venlo", "NL"],
  ["maersk-rotterdam-nl", "Maersk", "APM Terminals Rotterdam", "RTM", "port_inland_terminal", "Europaweg 875", "3199", "Maasvlakte", "NL"],
  ["dpworld-antwerp-be", "DP World", "Antwerp Gateway", "ANR", "port_inland_terminal", "Scheldelaan 170", "2030", "Antwerp", "BE"],
  ["zalando-lz-erfurt-de", "Zalando", "Logistics Centre Erfurt", "LZ-ERF", "fulfillment_center", "Am Flugplatz 1", "99092", "Erfurt", "DE"],
  ["dhl-riga-lv", "DHL", "DHL Freight Riga", "RIX", "logistics_terminal", "Daugavgrīvas iela 106", "LV-1016", "Riga", "LV"],
  ["dhl-vilnius-lt", "DHL", "DHL Freight Vilnius", "VNO", "logistics_terminal", "Ozo g. 12A", "LT-08200", "Vilnius", "LT"],
  ["omniva-tallinn-ee", "Omniva", "Logistics Centre Tallinn", "TLL", "logistics_terminal", "Peterburi tee 81", "11415", "Tallinn", "EE"],
  ["dhl-athens-gr", "DHL", "DHL Hub Athens", "ATH", "logistics_terminal", "Attiki Odos 62", "190 02", "Paiania", "GR"],
  ["dhl-lisbon-pt", "DHL", "DHL Terminal Lisbon", "LIS", "logistics_terminal", "Rua C 2", "2685-888", "Prior Velho", "PT"],
  ["db-schenker-zagreb-hr", "DB Schenker", "Schenker Terminal Zagreb", "ZAG", "logistics_terminal", "Slavonska avenija 22", "10000", "Zagreb", "HR"],
  ["dhl-belgrade-rs", "DHL", "DHL Freight Belgrade", "BEG", "logistics_terminal", "Bulevar Vojvode Mišića 33", "11000", "Belgrade", "RS"],
  ["dhl-sarajevo-ba", "DHL", "DHL Express Sarajevo", "SJJ", "logistics_terminal", "Zmaja od Bosne 8", "71000", "Sarajevo", "BA"],
  ["novaposhta-kyiv-ua", "Nova Poshta", "Logistics Terminal Kyiv", "KBP", "logistics_terminal", "Pryluzhna 8", "02081", "Kyiv", "UA"],
  ["dhl-basel-ch", "DHL", "DHL Global Forwarding Basel", "BSL", "logistics_terminal", "Grünaustrasse 14", "4058", "Basel", "CH"],
  ["dhl-luxembourg-lu", "DHL", "DHL Aviation Luxembourg", "LUX-DHL", "logistics_terminal", "Rue de Trèves", "L-2632", "Findel", "LU"],
  ["postnord-kista-se", "PostNord", "Terminal Kista", "KIS", "logistics_terminal", "Finspångsgatan 54", "16474", "Kista", "SE"],
  ["postnord-albertslund-dk", "PostNord", "Terminal Albertslund", "ALB", "logistics_terminal", "Herstedvang 7A", "2620", "Albertslund", "DK"],
  ["posti-turku-fi", "Posti", "Logistics Centre Turku", "TKU", "logistics_terminal", "Juhana Herttuan puistokatu 21", "20240", "Turku", "FI"],
  ["bring-oslo-no", "Bring", "Terminal Oslo", "OSL", "logistics_terminal", "Lindebergveien 10", "1068", "Oslo", "NO"],
];

async function geocode(city, postal, country, address) {
  const parts = [address, postal, city, country].filter(Boolean);
  const params = new URLSearchParams({
    q: parts.join(", "),
    format: "json",
    limit: "1",
    countrycodes: country.toLowerCase(),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "LoadmaxPZPP2-SeedBuilder/1.0" },
  });
  const data = await res.json();
  if (!data.length) throw new Error(`No result for ${parts.join(", ")}`);
  return [+Number(data[0].lat).toFixed(5), +Number(data[0].lon).toFixed(5)];
}

const rows = [];
for (let i = 0; i < SITES.length; i++) {
  const [id, company, fname, fcode, ftype, addr, pc, city, cc] = SITES[i];
  try {
    const [lat, lon] = await geocode(city, pc, cc, addr);
    rows.push([id, company, fname, fcode, ftype, addr, pc, city, cc, lat, lon]);
    console.log(`${i + 1}/${SITES.length} ${id} → ${lat},${lon}`);
  } catch (e) {
    console.error(`SKIP ${id}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Wrote ${rows.length} rows to ${OUT}`);
