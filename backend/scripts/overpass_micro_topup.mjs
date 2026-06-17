#!/usr/bin/env node
/** Small-bbox Overpass top-up (nodes only, fast) until TARGET reached. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1090;
const VERIFIED_AT = "2026-06-15";
const EPS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const BOXES = [];
for (let lat = 43; lat < 70; lat += 1.5) {
  for (let lon = -5; lon < 35; lon += 2) {
    BOXES.push({ s: lat, w: lon, n: Math.min(lat + 1.5, 71), e: Math.min(lon + 2, 40) });
  }
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
    byId.set(s.id, { ...s, verified_at: VERIFIED_AT });
    coords.add(k);
    added++;
  }
  return { catalog: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added };
}

function parse(elements) {
  const out = [];
  for (const el of elements) {
    if (!el.tags?.name || el.lat == null) continue;
    const tags = el.tags;
    const name = tags.name;
    const company = (tags.operator || tags.brand || name.split(/[\s,]/)[0]).split(";")[0].trim();
    const city = tags["addr:city"] || tags["addr:town"] || "Unknown";
    const cc = (tags["addr:country"] || "EU").slice(0, 2).toUpperCase();
    out.push({
      id: slugify(`micro-${company}-${name}-${city}-${el.id}`).slice(0, 120),
      company: company.slice(0, 60),
      facility_name: name.slice(0, 120),
      facility_type: "contract_logistics_warehouse",
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

async function fetchBox(box) {
  const q = `[out:json][timeout:25];(node["industrial"="logistics"](${box.s},${box.w},${box.n},${box.e});node["warehouse"="yes"]["name"](${box.s},${box.w},${box.n},${box.e});node["building"="warehouse"]["name"](${box.s},${box.w},${box.n},${box.e});node["amenity"="freight_terminal"]["name"](${box.s},${box.w},${box.n},${box.e}););out body 40;`;
  for (const ep of EPS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(28000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return parse(data.elements || []);
    } catch {
      /* try next endpoint */
    }
  }
  return [];
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

for (let i = 0; i < BOXES.length && catalog.length < TARGET; i++) {
  const box = BOXES[i];
  const batch = await fetchBox(box);
  const { catalog: next, added } = merge(catalog, batch);
  catalog = next;
  if (added > 0) console.log(`box ${box.s},${box.w}: +${added} → ${catalog.length}`);
  if ((i + 1) % 15 === 0) writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 400));
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`DONE: ${catalog.length}`);
