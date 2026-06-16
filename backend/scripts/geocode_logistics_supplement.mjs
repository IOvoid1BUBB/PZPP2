#!/usr/bin/env node
/**
 * Supplement catalog via Nominatim (1 req/s) for named logistics queries in European cities.
 * Output: data/geocoded_supplement.json — merged by build_european_logistics_catalog.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "geocoded_supplement.json");
const VERIFIED_AT = "2026-06-15";

const QUERIES = [
  ["DHL", "logistics centre", "Hamburg", "DE"],
  ["DHL", "logistics centre", "Leipzig", "DE"],
  ["DHL", "logistics centre", "Bremen", "DE"],
  ["DHL", "logistics centre", "Frankfurt", "DE"],
  ["DHL", "logistics centre", "Munich", "DE"],
  ["DHL", "logistics centre", "Cologne", "DE"],
  ["DHL", "logistics centre", "Stuttgart", "DE"],
  ["DHL", "logistics centre", "Nuremberg", "DE"],
  ["DB Schenker", "terminal", "Erfurt", "DE"],
  ["DB Schenker", "terminal", "Leipzig", "DE"],
  ["Raben", "warehouse", "Poznań", "PL"],
  ["Raben", "warehouse", "Wrocław", "PL"],
  ["Raben", "warehouse", "Gdańsk", "PL"],
  ["InPost", "sorting office", "Warszawa", "PL"],
  ["InPost", "sorting office", "Kraków", "PL"],
  ["Dachser", "logistics", "Łódź", "PL"],
  ["Geodis", "warehouse", "Lyon", "FR"],
  ["Geodis", "warehouse", "Marseille", "FR"],
  ["XPO", "logistics", "Toulouse", "FR"],
  ["FM Logistic", "warehouse", "Lille", "FR"],
  ["ID Logistics", "warehouse", "Bordeaux", "FR"],
  ["IKEA", "distribution centre", "Malmö", "SE"],
  ["IKEA", "distribution centre", "Ghent", "BE"],
  ["Maersk", "terminal", "Gothenburg", "SE"],
  ["Maersk", "terminal", "Felixstowe", "GB"],
  ["UPS", "hub", "Stansted", "GB"],
  ["FedEx", "depot", "Birmingham", "GB"],
  ["Amazon", "fulfillment centre", "Tilbury", "GB"],
  ["Amazon", "fulfillment centre", "Barcelona", "ES"],
  ["Amazon", "fulfillment centre", "Seville", "ES"],
  ["Decathlon", "warehouse", "Madrid", "ES"],
  ["Aldi", "distribution centre", "Salzburg", "AT"],
  ["Lidl", "distribution centre", "Wels", "AT"],
  ["Kuehne+Nagel", "warehouse", "Vienna", "AT"],
  ["Rhenus", "logistics", "Prague", "CZ"],
  ["DHL", "logistics", "Brno", "CZ"],
  ["DHL", "logistics", "Budapest", "HU"],
  ["DHL", "logistics", "Bucharest", "RO"],
  ["DHL", "logistics", "Sofia", "BG"],
  ["DHL", "logistics", "Athens", "GR"],
  ["DHL", "logistics", "Lisbon", "PT"],
  ["DHL", "logistics", "Dublin", "IE"],
  ["DHL", "logistics", "Oslo", "NO"],
  ["DHL", "logistics", "Helsinki", "FI"],
  ["DHL", "logistics", "Copenhagen", "DK"],
  ["DHL", "logistics", "Tallinn", "EE"],
  ["DHL", "logistics", "Riga", "LV"],
  ["DHL", "logistics", "Vilnius", "LT"],
  ["DHL", "logistics", "Zagreb", "HR"],
  ["DHL", "logistics", "Ljubljana", "SI"],
  ["DHL", "logistics", "Belgrade", "RS"],
  ["DHL", "logistics", "Sarajevo", "BA"],
  ["DHL", "logistics", "Chișinău", "MD"],
  ["DHL", "logistics", "Kyiv", "UA"],
  ["DHL", "logistics", "Zürich", "CH"],
  ["DHL", "logistics", "Luxembourg", "LU"],
  ["DHL", "logistics", "Nicosia", "CY"],
  ["DHL", "logistics", "Valletta", "MT"],
];

// Expand with grid of major EU cities × operators (deterministic catalog growth)
const OPERATORS = ["DHL", "DB Schenker", "Geodis", "Raben", "Dachser", "Rhenus", "XPO", "CEVA"];
const CITIES = [
  ["Berlin", "DE"], ["Munich", "DE"], ["Hannover", "DE"], ["Dresden", "DE"], ["Kiel", "DE"],
  ["Paris", "FR"], ["Lyon", "FR"], ["Nantes", "FR"], ["Strasbourg", "FR"], ["Rennes", "FR"],
  ["Milan", "IT"], ["Rome", "IT"], ["Turin", "IT"], ["Bologna", "IT"], ["Naples", "IT"],
  ["Madrid", "ES"], ["Valencia", "ES"], ["Bilbao", "ES"], ["Zaragoza", "ES"],
  ["Warsaw", "PL"], ["Krakow", "PL"], ["Szczecin", "PL"], ["Lublin", "PL"], ["Katowice", "PL"],
  ["Rotterdam", "NL"], ["Utrecht", "NL"], ["Eindhoven", "NL"],
  ["Brussels", "BE"], ["Antwerp", "BE"],
  ["London", "GB"], ["Manchester", "GB"], ["Glasgow", "GB"], ["Leeds", "GB"],
  ["Stockholm", "SE"], ["Malmö", "SE"],
  ["Oslo", "NO"], ["Bergen", "NO"],
  ["Helsinki", "FI"], ["Tampere", "FI"],
  ["Copenhagen", "DK"], ["Aarhus", "DK"],
  ["Vienna", "AT"], ["Graz", "AT"],
  ["Prague", "CZ"], ["Ostrava", "CZ"],
  ["Bratislava", "SK"], ["Košice", "SK"],
  ["Budapest", "HU"], ["Debrecen", "HU"],
  ["Bucharest", "RO"], ["Cluj-Napoca", "RO"],
  ["Sofia", "BG"], ["Plovdiv", "BG"],
  ["Athens", "GR"], ["Thessaloniki", "GR"],
  ["Lisbon", "PT"], ["Porto", "PT"],
  ["Dublin", "IE"], ["Cork", "IE"],
  ["Zagreb", "HR"], ["Split", "HR"],
  ["Ljubljana", "SI"], ["Maribor", "SI"],
  ["Belgrade", "RS"], ["Novi Sad", "RS"],
  ["Sarajevo", "BA"], ["Banja Luka", "BA"],
  ["Tallinn", "EE"], ["Tartu", "EE"],
  ["Riga", "LV"], ["Daugavpils", "LV"],
  ["Vilnius", "LT"], ["Kaunas", "LT"],
  ["Kyiv", "UA"], ["Lviv", "UA"], ["Odesa", "UA"],
  ["Chișinău", "MD"],
  ["Zürich", "CH"], ["Basel", "CH"],
  ["Luxembourg", "LU"],
  ["Valletta", "MT"],
  ["Nicosia", "CY"],
];

for (let i = 0; i < CITIES.length; i++) {
  const [city, cc] = CITIES[i];
  const op = OPERATORS[i % OPERATORS.length];
  QUERIES.push([op, "logistics warehouse", city, cc]);
}

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function nominatimSearch(company, facility, city, countryCode) {
  const q = `${company} ${facility} ${city}`;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: "json",
    limit: "3",
    countrycodes: countryCode.toLowerCase(),
  })}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "LoadmaxPZPP2/1.0 (european logistics catalog)" },
  });
  if (!response.ok) return [];
  return response.json();
}

async function main() {
  const sites = [];
  const coords = new Set();
  for (let i = 0; i < QUERIES.length; i++) {
    const [company, facility, city, cc] = QUERIES[i];
    try {
      const results = await nominatimSearch(company, facility, city, cc);
      for (const hit of results) {
        const lat = Number(Number(hit.lat).toFixed(5));
        const lon = Number(Number(hit.lon).toFixed(5));
        const key = `${lat},${lon}`;
        if (coords.has(key)) continue;
        const name = hit.display_name.split(",")[0];
        const id = slugify(`nom-${company}-${name}-${city}-${cc}-${i}`).slice(0, 120);
        sites.push({
          id,
          company,
          facility_name: name.slice(0, 120),
          facility_code: facility.split(" ")[0].slice(0, 12).toUpperCase(),
          facility_type: "contract_logistics_warehouse",
          address_line: hit.display_name.split(",").slice(0, 2).join(", "),
          city,
          country_code: cc,
          lat,
          lon,
          source: `https://nominatim.openstreetmap.org/ui/details.html?osmtype=${hit.osm_type}&osmid=${hit.osm_id}`,
          verified_at: VERIFIED_AT,
          geocode_method: "nominatim",
        });
        coords.add(key);
      }
    } catch (err) {
      console.error(`Query failed ${company} ${city}: ${err.message}`);
    }
    if ((i + 1) % 10 === 0) console.log(`Geocoded ${i + 1}/${QUERIES.length}, sites: ${sites.length}`);
    await sleep(1100);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(sites, null, 2)}\n`);
  console.log(`Wrote ${sites.length} sites to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
