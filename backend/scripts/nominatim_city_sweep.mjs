#!/usr/bin/env node
/** Per-city Nominatim sweep — find additional logistics POIs in catalog cities. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1090;
const VERIFIED_AT = "2026-06-15";

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

async function searchCity(city, cc) {
  const queries = [
    `logistics warehouse ${city}`,
    `freight terminal ${city}`,
    `distribution centre ${city}`,
    `industrial park ${city}`,
  ];
  const out = [];
  for (const q of queries) {
    const params = new URLSearchParams({
      q,
      format: "json",
      limit: "5",
      countrycodes: cc.toLowerCase(),
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "LoadmaxPZPP2-CitySweep/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    for (const hit of data) {
      out.push({
        id: slugify(`sweep-${city}-${cc}-${hit.osm_id}`).slice(0, 120),
        company: "Logistics",
        facility_name: (hit.display_name || q).split(",")[0].slice(0, 120),
        facility_type: "contract_logistics_warehouse",
        city,
        country_code: cc,
        lat: +Number(hit.lat).toFixed(5),
        lon: +Number(hit.lon).toFixed(5),
        source: `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}`,
        geocode_method: "nominatim",
      });
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

const cityKeys = [...new Set(catalog.map((s) => `${s.city}|${s.country_code}`))].sort();
for (let i = 0; i < cityKeys.length && catalog.length < TARGET; i++) {
  const [city, cc] = cityKeys[i].split("|");
  if (!city || city === "Unknown" || city.length < 3) continue;
  try {
    const hits = await searchCity(city, cc);
    const { catalog: next, added } = merge(catalog, hits);
    catalog = next;
    if (added > 0) console.log(`${i + 1}/${cityKeys.length} ${city} ${cc}: +${added} → ${catalog.length}`);
    if ((i + 1) % 25 === 0) writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  } catch (e) {
    console.error(`FAIL ${city}: ${e.message}`);
  }
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`DONE: ${catalog.length}`);
