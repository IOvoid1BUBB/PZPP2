#!/usr/bin/env node
/** Fast top-up: re-query large countries with limit 250 (nodes only). */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const EP = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"];
const VERIFIED_AT = "2026-06-15";

const COUNTRIES = [
  "DE", "FR", "GB", "PL", "ES", "IT", "NL", "RO", "HU", "CZ", "SE", "NO", "AT", "CH", "BE",
  "DK", "FI", "PT", "BG", "GR", "SK", "HR", "RS", "SI", "IE", "LT", "LV", "EE", "UA", "BA",
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

function parse(elements, cc) {
  const out = [];
  for (const el of elements) {
    if (!el.tags?.name || el.lat == null) continue;
    const tags = el.tags;
    const name = tags.name;
    const company = (tags.operator || tags.brand || name.split(/[\s,]/)[0]).split(";")[0].trim();
    const city = tags["addr:city"] || tags["addr:town"] || "Unknown";
    out.push({
      id: slugify(`osm2-${company}-${name}-${city}-${cc}-${el.id}`).slice(0, 120),
      company: company.slice(0, 60),
      facility_name: name.slice(0, 120),
      facility_type: "contract_logistics_warehouse",
      address_line: tags["addr:street"] || null,
      postal_code: tags["addr:postcode"] || null,
      city,
      country_code: cc,
      lat: +Number(el.lat).toFixed(5),
      lon: +Number(el.lon).toFixed(5),
      source: `https://www.openstreetmap.org/node/${el.id}`,
      geocode_method: "osm_overpass",
    });
  }
  return out;
}

async function fetchCountry(cc) {
  const q = `[out:json][timeout:45];area["ISO3166-1"="${cc}"]->.a;(node["industrial"="logistics"](area.a);node["landuse"="industrial"]["name"](area.a);node["warehouse"="yes"]["name"](area.a);node["building"="warehouse"]["name"](area.a);node["amenity"="freight_terminal"]["name"](area.a);node["man_made"="works"]["name"](area.a););out body 250;`;
  for (const ep of EP) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(55000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return parse(data.elements || [], cc);
    } catch {
      /* next */
    }
  }
  return [];
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

for (const cc of COUNTRIES) {
  if (catalog.length >= 1200) break;
  const batch = await fetchCountry(cc);
  const { catalog: next, added } = merge(catalog, batch);
  catalog = next;
  console.log(`${cc}: +${added} (fetched ${batch.length}) → ${catalog.length}`);
  writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 700));
}

console.log(`DONE: ${catalog.length}, countries: ${new Set(catalog.map((s) => s.country_code)).size}`);
