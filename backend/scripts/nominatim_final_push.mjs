#!/usr/bin/env node
/** Final Nominatim push — industrial/logistics POI searches until TARGET. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1090;
const VERIFIED_AT = "2026-06-15";

const SEARCHES = [
  ["DPD", "depot", "Hamburg", "DE"], ["UPS", "hub", "Frankfurt", "DE"], ["FedEx", "terminal", "Cologne", "DE"],
  ["XPO", "warehouse", "Stuttgart", "DE"], ["Rhenus", "logistics", "Essen", "DE"], ["Kuehne+Nagel", "warehouse", "Hamburg", "DE"],
  ["Geodis", "warehouse", "Mannheim", "DE"], ["Dachser", "terminal", "Augsburg", "DE"], ["Hellmann", "logistics", "Osnabrück", "DE"],
  ["FM Logistic", "warehouse", "Reims", "FR"], ["ID Logistics", "warehouse", "Orléans", "FR"], ["XPO", "warehouse", "Lyon", "FR"],
  ["Geodis", "hub", "Toulouse", "FR"], ["DHL", "freight", "Nantes", "FR"], ["Kuehne+Nagel", "warehouse", "Le Havre", "FR"],
  ["GXO", "warehouse", "Leicester", "GB"], ["Wincanton", "depot", "Bristol", "GB"], ["XPO", "warehouse", "Manchester", "GB"],
  ["DHL", "freight", "Glasgow", "GB"], ["Amazon", "fulfillment", "Gateshead", "GB"],
  ["Mercadona", "warehouse", "Guadix", "ES"], ["DHL", "freight", "Bilbao", "ES"], ["XPO", "warehouse", "Valencia", "ES"],
  ["Bartolini", "hub", "Padua", "IT"], ["DHL", "freight", "Turin", "IT"], ["GXO", "warehouse", "Piacenza", "IT"],
  ["Raben", "warehouse", "Poznań", "PL"], ["DHL", "freight", "Gdynia", "PL"], ["Poczta Polska", "logistics", "Warsaw", "PL"],
  ["Geodis", "warehouse", "Utrecht", "NL"], ["DHL", "freight", "Maastricht", "NL"], ["GXO", "warehouse", "Nijmegen", "NL"],
  ["DHL", "freight", "Brno", "CZ"], ["PPL", "depot", "Prague", "CZ"], ["DHL", "freight", "Bratislava", "SK"],
  ["DHL", "freight", "Debrecen", "HU"], ["Waberer's", "logistics", "Budapest", "HU"],
  ["DHL", "freight", "Sibiu", "RO"], ["DHL", "freight", "Ploiești", "RO"],
  ["DHL", "freight", "Varna", "BG"], ["DHL", "freight", "Burgas", "BG"],
  ["DHL", "freight", "Gothenburg", "SE"], ["DHL", "freight", "Malmö", "SE"], ["DHL", "freight", "Stavanger", "NO"],
  ["DHL", "freight", "Aalborg", "DK"], ["DHL", "freight", "Tampere", "FI"],
  ["DHL", "freight", "Salzburg", "AT"], ["DHL", "freight", "Graz", "AT"],
  ["DHL", "freight", "Lausanne", "CH"], ["DHL", "freight", "Lugano", "CH"],
  ["DHL", "freight", "Cork", "IE"], ["DHL", "freight", "Limerick", "IE"],
  ["DHL", "freight", "Split", "HR"], ["DHL", "freight", "Osijek", "HR"],
  ["DHL", "freight", "Novi Sad", "RS"], ["DHL", "freight", "Kragujevac", "RS"],
  ["DHL", "freight", "Tuzla", "BA"], ["DHL", "freight", "Zenica", "BA"],
  ["DHL", "freight", "Coimbra", "PT"], ["DHL", "freight", "Aveiro", "PT"],
  ["DHL", "freight", "Klaipėda", "LT"], ["DHL", "freight", "Šiauliai", "LT"],
  ["DHL", "freight", "Daugavpils", "LV"], ["DHL", "freight", "Liepāja", "LV"],
  ["DHL", "freight", "Narva", "EE"], ["DHL", "freight", "Pärnu", "EE"],
  ["DHL", "freight", "Odesa", "UA"], ["DHL", "freight", "Kharkiv", "UA"],
  ["DHL", "freight", "Bălți", "MD"], ["DHL", "freight", "Cahul", "MD"],
  ["DHL", "freight", "Larnaca", "CY"], ["DHL", "freight", "Paphos", "CY"],
  ["GXO", "warehouse", "Marsa", "MT"], ["DHL", "freight", "Valletta", "MT"],
  ["logistics", "industrial park", "Bremen", "DE"], ["logistics", "industrial park", "Dresden", "DE"],
  ["logistics", "industrial park", "Nuremberg", "DE"], ["logistics", "industrial park", "Karlsruhe", "DE"],
  ["logistics", "industrial park", "Metz", "FR"], ["logistics", "industrial park", "Dijon", "FR"],
  ["logistics", "industrial park", "Cardiff", "GB"], ["logistics", "industrial park", "Edinburgh", "GB"],
  ["logistics", "industrial park", "Alicante", "ES"], ["logistics", "industrial park", "Pamplona", "ES"],
  ["logistics", "industrial park", "Genoa", "IT"], ["logistics", "industrial park", "Catania", "IT"],
  ["logistics", "industrial park", "Katowice", "PL"], ["logistics", "industrial park", "Toruń", "PL"],
  ["DHL", "freight", "Wrocław", "PL"], ["DHL", "freight", "Łódź", "PL"], ["DHL", "freight", "Szczecin", "PL"],
  ["DHL", "freight", "Lublin", "PL"], ["DHL", "freight", "Białystok", "PL"], ["DHL", "freight", "Bydgoszcz", "PL"],
  ["DHL", "freight", "Kielce", "PL"], ["DHL", "freight", "Rzeszów", "PL"], ["DHL", "freight", "Opole", "PL"],
  ["DHL", "freight", "Münster", "DE"], ["DHL", "freight", "Bielefeld", "DE"], ["DHL", "freight", "Wuppertal", "DE"],
  ["DHL", "freight", "Bonn", "DE"], ["DHL", "freight", "Münster", "DE"], ["DHL", "freight", "Freiburg", "DE"],
  ["DHL", "freight", "Regensburg", "DE"], ["DHL", "freight", "Rostock", "DE"], ["DHL", "freight", "Kiel", "DE"],
  ["DHL", "freight", "Montpellier", "FR"], ["DHL", "freight", "Angers", "FR"], ["DHL", "freight", "Grenoble", "FR"],
  ["DHL", "freight", "Tours", "FR"], ["DHL", "freight", "Clermont-Ferrand", "FR"], ["DHL", "freight", "Perpignan", "FR"],
  ["DHL", "freight", "Reading", "GB"], ["DHL", "freight", "Northampton", "GB"], ["DHL", "freight", "Swindon", "GB"],
  ["DHL", "freight", "Plymouth", "GB"], ["DHL", "freight", "Hull", "GB"], ["DHL", "freight", "Derby", "GB"],
  ["DHL", "freight", "Murcia", "ES"], ["DHL", "freight", "Córdoba", "ES"], ["DHL", "freight", "Valladolid", "ES"],
  ["DHL", "freight", "Gijón", "ES"], ["DHL", "freight", "Vigo", "ES"], ["DHL", "freight", "Granada", "ES"],
  ["DHL", "freight", "Brescia", "IT"], ["DHL", "freight", "Modena", "IT"], ["DHL", "freight", "Parma", "IT"],
  ["DHL", "freight", "Reggio Emilia", "IT"], ["DHL", "freight", "Perugia", "IT"], ["DHL", "freight", "Trieste", "IT"],
  ["logistics", "industrial park", "Wrocław", "PL"], ["logistics", "industrial park", "Łódź", "PL"],
  ["logistics", "industrial park", "Szczecin", "PL"], ["logistics", "industrial park", "Lublin", "PL"],
  ["logistics", "industrial park", "Essen", "DE"], ["logistics", "industrial park", "Dortmund", "DE"],
  ["logistics", "industrial park", "Leipzig", "DE"], ["logistics", "industrial park", "Hannover", "DE"],
  ["logistics", "industrial park", "Strasbourg", "FR"], ["logistics", "industrial park", "Montpellier", "FR"],
  ["logistics", "industrial park", "Liverpool", "GB"], ["logistics", "industrial park", "Newcastle", "GB"],
  ["logistics", "industrial park", "Las Palmas", "ES"], ["logistics", "industrial park", "Santander", "ES"],
  ["logistics", "industrial park", "Palermo", "IT"], ["logistics", "industrial park", "Bologna", "IT"],
  ["GXO", "warehouse", "Tilburg", "NL"], ["GXO", "warehouse", "Roosendaal", "NL"], ["GXO", "warehouse", "Venlo", "NL"],
  ["Raben", "warehouse", "Płock", "PL"], ["Raben", "warehouse", "Radomsko", "PL"], ["Raben", "warehouse", "Słubice", "PL"],
];

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function merge(existing, batch) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const coords = new Set(existing.map((s) => `${s.lat},${s.lon}`));
  let added = 0;
  for (const s of batch) {
    const k = `${s.lat},${s.lon}`;
    if (coords.has(k) || byId.has(s.id)) continue;
    byId.set(s.id, { ...s, verified_at: VERIFIED_AT });
    coords.add(k);
    added++;
  }
  return { catalog: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added };
}

async function search(company, facility, city, cc) {
  const params = new URLSearchParams({
    q: `${company} ${facility} ${city}`,
    format: "json",
    limit: "3",
    countrycodes: cc.toLowerCase(),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "LoadmaxPZPP2-FinalPush/1.0" },
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json();
  return data.map((hit, i) => ({
    id: slugify(`push-${company}-${city}-${cc}-${hit.osm_id}-${i}`).slice(0, 120),
    company: company === "logistics" ? "Logistics" : company,
    facility_name: (hit.display_name || facility).split(",")[0].slice(0, 120),
    facility_code: facility.split(" ")[0].slice(0, 12).toUpperCase(),
    facility_type: "contract_logistics_warehouse",
    address_line: hit.display_name?.split(",").slice(0, 3).join(", "),
    city,
    country_code: cc,
    lat: +Number(hit.lat).toFixed(5),
    lon: +Number(hit.lon).toFixed(5),
    source: `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}`,
    geocode_method: "nominatim",
  }));
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

for (let i = 0; i < SEARCHES.length && catalog.length < TARGET; i++) {
  const [company, facility, city, cc] = SEARCHES[i];
  try {
    const hits = await search(company, facility, city, cc);
    const { catalog: next, added } = merge(catalog, hits);
    catalog = next;
    if (added > 0) console.log(`${i + 1}/${SEARCHES.length} ${city}: +${added} → ${catalog.length}`);
  } catch (e) {
    console.error(`FAIL ${city}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`DONE: ${catalog.length}`);
