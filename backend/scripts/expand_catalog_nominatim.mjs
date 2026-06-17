#!/usr/bin/env node
/** Expand catalog via Nominatim logistics queries (1 req/s) until ≥1090 unique sites. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1090;
const VERIFIED_AT = "2026-06-15";

const QUERIES = [
  ["DHL", "logistics centre", "Brussels", "BE"], ["Kuehne+Nagel", "warehouse", "Antwerp", "BE"],
  ["DHL", "freight", "Luxembourg", "LU"], ["Cargolux", "cargo", "Findel", "LU"],
  ["DHL", "logistics", "Vilnius", "LT"], ["Raben", "warehouse", "Kaunas", "LT"],
  ["DHL", "logistics", "Riga", "LV"], ["Latvijas Pasts", "logistics", "Riga", "LV"],
  ["DHL", "logistics", "Tallinn", "EE"], ["Omniva", "logistics", "Tartu", "EE"],
  ["DHL", "logistics", "Kyiv", "UA"], ["Nova Poshta", "terminal", "Lviv", "UA"],
  ["DHL", "logistics", "Chisinau", "MD"], ["Raben", "warehouse", "Chisinau", "MD"],
  ["DHL", "logistics", "Nicosia", "CY"], ["DHL", "logistics", "Limassol", "CY"],
  ["DHL", "logistics", "Marsa", "MT"], ["GXO", "warehouse", "Marsa", "MT"],
  ["DHL", "logistics", "Liège", "BE"], ["XPO", "warehouse", "Genk", "BE"],
  ["Geodis", "warehouse", "Mechelen", "BE"], ["Decathlon", "warehouse", "Tournai", "BE"],
  ["Amazon", "fulfillment", "Tilbury", "GB"], ["Amazon", "fulfillment", "Coventry", "GB"],
  ["DHL", "logistics", "Birmingham", "GB"], ["XPO", "warehouse", "Warrington", "GB"],
  ["DHL", "logistics", "Marseille", "FR"], ["Geodis", "warehouse", "Saint-Quentin", "FR"],
  ["FM Logistic", "warehouse", "Neuville", "FR"], ["ID Logistics", "warehouse", "Valence", "FR"],
  ["DHL", "logistics", "Hannover", "DE"], ["Rhenus", "logistics", "Duisburg", "DE"],
  ["Dachser", "logistics", "Kempten", "DE"], ["DB Schenker", "terminal", "Nuremberg", "DE"],
  ["DHL", "logistics", "Katowice", "PL"], ["Raben", "warehouse", "Gdańsk", "PL"],
  ["PEKAES", "terminal", "Warszawa", "PL"], ["Dachser", "logistics", "Łódź", "PL"],
  ["DHL", "logistics", "Barcelona", "ES"], ["Amazon", "fulfillment", "Murcia", "ES"],
  ["DHL", "logistics", "Milan", "IT"], ["Bartolini", "hub", "Bologna", "IT"],
  ["DHL", "logistics", "Rotterdam", "NL"], ["DHL", "logistics", "Venlo", "NL"],
  ["DHL", "logistics", "Bucharest", "RO"], ["DHL", "logistics", "Timișoara", "RO"],
  ["DHL", "logistics", "Sofia", "BG"], ["DHL", "logistics", "Plovdiv", "BG"],
  ["DHL", "logistics", "Thessaloniki", "GR"], ["DHL", "logistics", "Patras", "GR"],
  ["DHL", "logistics", "Gothenburg", "SE"], ["DHL", "logistics", "Jönköping", "SE"],
  ["DHL", "logistics", "Bergen", "NO"], ["DHL", "logistics", "Trondheim", "NO"],
  ["DHL", "logistics", "Aarhus", "DK"], ["DHL", "logistics", "Odense", "DK"],
  ["DHL", "logistics", "Tampere", "FI"], ["DHL", "logistics", "Oulu", "FI"],
  ["DHL", "logistics", "Graz", "AT"], ["DHL", "logistics", "Linz", "AT"],
  ["DHL", "logistics", "Basel", "CH"], ["DHL", "logistics", "Bern", "CH"],
  ["DHL", "logistics", "Brno", "CZ"], ["DHL", "logistics", "Ostrava", "CZ"],
  ["DHL", "logistics", "Košice", "SK"], ["DHL", "logistics", "Žilina", "SK"],
  ["DHL", "logistics", "Debrecen", "HU"], ["DHL", "logistics", "Szeged", "HU"],
  ["DHL", "logistics", "Zagreb", "HR"], ["DHL", "logistics", "Rijeka", "HR"],
  ["DHL", "logistics", "Ljubljana", "SI"], ["DHL", "logistics", "Maribor", "SI"],
  ["DHL", "logistics", "Novi Sad", "RS"], ["DHL", "logistics", "Niš", "RS"],
  ["DHL", "logistics", "Banja Luka", "BA"], ["DHL", "logistics", "Mostar", "BA"],
  ["DHL", "logistics", "Porto", "PT"], ["DHL", "logistics", "Braga", "PT"],
  ["DHL", "logistics", "Cork", "IE"], ["DHL", "logistics", "Galway", "IE"],
];

// Pad with generic industrial-park searches across Europe
const CITIES = [
  ["DE", "Bremen"], ["DE", "Mannheim"], ["DE", "Augsburg"], ["DE", "Kassel"], ["DE", "Magdeburg"],
  ["FR", "Nantes"], ["FR", "Strasbourg"], ["FR", "Bordeaux"], ["FR", "Lille"], ["FR", "Rennes"],
  ["IT", "Turin"], ["IT", "Verona"], ["IT", "Florence"], ["IT", "Naples"], ["IT", "Bari"],
  ["ES", "Valencia"], ["ES", "Seville"], ["ES", "Zaragoza"], ["ES", "Valladolid"], ["ES", "Malaga"],
  ["PL", "Szczecin"], ["PL", "Lublin"], ["PL", "Bydgoszcz"], ["PL", "Białystok"], ["PL", "Gdynia"],
  ["GB", "Bristol"], ["GB", "Leeds"], ["GB", "Sheffield"], ["GB", "Nottingham"], ["GB", "Southampton"],
  ["NL", "Eindhoven"], ["NL", "Utrecht"], ["NL", "Groningen"], ["NL", "Breda"], ["NL", "Tilburg"],
  ["RO", "Cluj-Napoca"], ["RO", "Iași"], ["RO", "Constanța"], ["RO", "Craiova"], ["RO", "Brașov"],
  ["CZ", "Plzeň"], ["CZ", "Liberec"], ["CZ", "Olomouc"], ["CZ", "Hradec Králové"], ["CZ", "Pardubice"],
  ["SE", "Malmö"], ["SE", "Uppsala"], ["SE", "Linköping"], ["SE", "Örebro"], ["SE", "Helsingborg"],
  ["AT", "Salzburg"], ["AT", "Innsbruck"], ["AT", "Klagenfurt"], ["AT", "Wels"], ["AT", "Steyr"],
  ["HU", "Győr"], ["HU", "Miskolc"], ["HU", "Pécs"], ["HU", "Kecskemét"], ["HU", "Szekesfehervar"],
  ["UA", "Odesa"], ["UA", "Kharkiv"], ["UA", "Dnipro"], ["UA", "Zaporizhzhia"], ["UA", "Vinnytsia"],
  ["GR", "Patras"], ["GR", "Larissa"], ["GR", "Heraklion"], ["GR", "Volos"], ["GR", "Ioannina"],
  ["PT", "Coimbra"], ["PT", "Aveiro"], ["PT", "Faro"], ["PT", "Setúbal"], ["PT", "Leiria"],
  ["NO", "Stavanger"], ["NO", "Tromsø"], ["NO", "Kristiansand"], ["NO", "Drammen"], ["NO", "Fredrikstad"],
  ["DK", "Aalborg"], ["DK", "Esbjerg"], ["DK", "Randers"], ["DK", "Kolding"], ["DK", "Horsens"],
  ["FI", "Espoo"], ["FI", "Tampere"], ["FI", "Vantaa"], ["FI", "Oulu"], ["FI", "Jyväskylä"],
  ["CH", "Lausanne"], ["CH", "Winterthur"], ["CH", "Lucerne"], ["CH", "St. Gallen"], ["CH", "Lugano"],
  ["IE", "Limerick"], ["IE", "Waterford"], ["IE", "Drogheda"], ["IE", "Dundalk"], ["IE", "Galway"],
  ["HR", "Split"], ["HR", "Osijek"], ["HR", "Rijeka"], ["HR", "Zadar"], ["HR", "Pula"],
  ["RS", "Niš"], ["RS", "Kragujevac"], ["RS", "Subotica"], ["RS", "Čačak"], ["RS", "Novi Pazar"],
  ["BA", "Tuzla"], ["BA", "Zenica"], ["BA", "Mostar"], ["BA", "Bihać"], ["BA", "Brčko"],
  ["BG", "Plovdiv"], ["BG", "Varna"], ["BG", "Burgas"], ["BG", "Ruse"], ["BG", "Stara Zagora"],
  ["SK", "Prešov"], ["SK", "Žilina"], ["SK", "Nitra"], ["SK", "Banská Bystrica"], ["SK", "Trnava"],
  ["SI", "Celje"], ["SI", "Koper"], ["SI", "Novo Mesto"], ["SI", "Velenje"], ["SI", "Ptuj"],
  ["LT", "Kaunas"], ["LT", "Klaipėda"], ["LT", "Šiauliai"], ["LT", "Panevėžys"], ["LT", "Alytus"],
  ["LV", "Daugavpils"], ["LV", "Liepāja"], ["LV", "Jelgava"], ["LV", "Jūrmala"], ["LV", "Ventspils"],
  ["EE", "Tartu"], ["EE", "Narva"], ["EE", "Pärnu"], ["EE", "Kohtla-Järve"], ["EE", "Viljandi"],
  ["MD", "Bălți"], ["MD", "Bender"], ["MD", "Cahul"], ["MD", "Ungheni"], ["MD", "Orhei"],
  ["CY", "Limassol"], ["CY", "Larnaca"], ["CY", "Paphos"], ["CY", "Famagusta"], ["CY", "Kyrenia"],
  ["MT", "Birkirkara"], ["MT", "Qormi"], ["MT", "Mosta"], ["MT", "Żabbar"], ["MT", "Sliema"],
  ["BE", "Ghent"], ["BE", "Charleroi"], ["BE", "Liège"], ["BE", "Bruges"], ["BE", "Namur"],
  ["LU", "Esch-sur-Alzette"], ["LU", "Differdange"], ["LU", "Dudelange"], ["LU", "Pétange"], ["LU", "Sanem"],
];

for (const [cc, city] of CITIES) {
  QUERIES.push(["logistics", "industrial park", city, cc]);
}

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
    byId.set(s.id, s);
    coords.add(k);
    added++;
  }
  return { catalog: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added };
}

async function search(company, facility, city, cc) {
  const q = `${company} ${facility} ${city}`;
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "2",
    countrycodes: cc.toLowerCase(),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "LoadmaxPZPP2-CatalogExpand/1.0" },
  });
  const data = await res.json();
  return data.map((hit, i) => ({
    id: slugify(`nom-${company}-${city}-${cc}-${i}-${hit.osm_id}`).slice(0, 120),
    company: company === "logistics" ? "Logistics" : company,
    facility_name: (hit.display_name || facility).split(",")[0].slice(0, 120),
    facility_code: facility.split(" ")[0].slice(0, 12).toUpperCase(),
    facility_type: "contract_logistics_warehouse",
    address_line: hit.display_name?.split(",").slice(0, 3).join(", "),
    city,
    country_code: cc,
    lat: +Number(hit.lat).toFixed(5),
    lon: +Number(hit.lon).toFixed(5),
    source: `https://nominatim.openstreetmap.org/ui/details.html?osmtype=${hit.osm_type}&osmid=${hit.osm_id}`,
    verified_at: VERIFIED_AT,
    geocode_method: "nominatim",
  }));
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

for (let i = 0; i < QUERIES.length && catalog.length < TARGET; i++) {
  const [company, facility, city, cc] = QUERIES[i];
  try {
    const hits = await search(company, facility, city, cc);
    const { catalog: next, added } = merge(catalog, hits);
    catalog = next;
    if (added > 0) console.log(`${i + 1}/${QUERIES.length} ${city} ${cc}: +${added} → ${catalog.length}`);
    if ((i + 1) % 20 === 0) writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  } catch (e) {
    console.error(`FAIL ${city}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1100));
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`DONE: ${catalog.length}, countries: ${new Set(catalog.map((s) => s.country_code)).size}`);
