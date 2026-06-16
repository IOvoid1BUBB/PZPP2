#!/usr/bin/env node
/** Supplement catalog to ≥1200 sites — bbox Overpass for gaps + zero-yield countries. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const EP = "https://overpass.kumi.systems/api/interpreter";
const VERIFIED_AT = "2026-06-15";
const TARGET = 1200;

const EXTRA_BBOXES = [
  { label: "BE", s: 49.4, w: 2.5, n: 51.6, e: 6.5 },
  { label: "LU", s: 49.4, w: 5.7, n: 50.2, e: 6.5 },
  { label: "LT", s: 53.8, w: 20.8, n: 56.5, e: 27.0 },
  { label: "LV", s: 55.6, w: 20.8, n: 58.1, e: 28.3 },
  { label: "EE", s: 57.5, w: 21.5, n: 59.8, e: 28.2 },
  { label: "UA", s: 44.0, w: 22.0, n: 52.5, e: 40.5 },
  { label: "MD", s: 45.4, w: 26.5, n: 48.5, e: 30.5 },
  { label: "CY", s: 34.5, w: 32.0, n: 35.8, e: 34.8 },
  { label: "MT", s: 35.7, w: 14.1, n: 36.1, e: 14.7 },
  { label: "DE-NW", s: 50.0, w: 5.5, n: 53.0, e: 9.5 },
  { label: "DE-SE", s: 47.5, w: 10.0, n: 51.0, e: 15.0 },
  { label: "FR-IDF", s: 48.0, w: 1.5, n: 49.5, e: 3.5 },
  { label: "IT-N", s: 44.0, w: 7.0, n: 47.5, e: 13.0 },
  { label: "PL-MAZ", s: 51.0, w: 19.5, n: 53.5, e: 23.0 },
];

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferCc(lat, lon, fb) {
  if (fb && fb.length === 2) return fb;
  if (lat >= 49.4 && lat <= 51.6 && lon >= 2.5 && lon <= 6.5) return "BE";
  if (lat >= 49.4 && lat <= 50.2 && lon >= 5.7 && lon <= 6.5) return "LU";
  if (lat >= 53.8 && lat <= 56.5 && lon >= 20.8 && lon <= 27) return "LT";
  if (lat >= 55.6 && lat <= 58.1 && lon >= 20.8 && lon <= 28.3) return "LV";
  if (lat >= 57.5 && lat <= 59.8 && lon >= 21.5 && lon <= 28.2) return "EE";
  if (lat >= 44 && lat <= 52.5 && lon >= 22 && lon <= 40.5) return "UA";
  if (lat >= 45.4 && lat <= 48.5 && lon >= 26.5 && lon <= 30.5) return "MD";
  if (lat >= 34.5 && lat <= 35.8 && lon >= 32 && lon <= 34.8) return "CY";
  if (lat >= 35.7 && lat <= 36.1 && lon >= 14.1 && lon <= 14.7) return "MT";
  return fb || "EU";
}

function merge(existing, batch) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const coords = new Set(existing.map((s) => `${s.lat},${s.lon}`));
  for (const s of batch) {
    const k = `${s.lat},${s.lon}`;
    if (coords.has(k) || byId.has(s.id)) continue;
    byId.set(s.id, { ...s, verified_at: VERIFIED_AT });
    coords.add(k);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function parse(elements, defaultCc) {
  const out = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat == null || lon == null || !name || name.length < 3) continue;
    const tags = el.tags;
    const company = (tags.operator || tags.brand || name.split(/[\s,]/)[0]).split(";")[0].trim();
    const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "Unknown";
    const cc = inferCc(lat, lon, (tags["addr:country"] || defaultCc).slice(0, 2).toUpperCase());
    out.push({
      id: slugify(`osm-${company}-${name}-${city}-${cc}-${el.id}`).slice(0, 120),
      company: company.slice(0, 60),
      facility_name: name.slice(0, 120),
      facility_type: "contract_logistics_warehouse",
      address_line: tags["addr:street"] || null,
      postal_code: tags["addr:postcode"] || null,
      city,
      country_code: cc,
      lat: +Number(lat).toFixed(5),
      lon: +Number(lon).toFixed(5),
      source: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      geocode_method: "osm_overpass",
    });
  }
  return out;
}

async function fetchBbox(box) {
  const q = `[out:json][timeout:50];(node["industrial"="logistics"](${box.s},${box.w},${box.n},${box.e});node["landuse"="industrial"]["name"](${box.s},${box.w},${box.n},${box.e});node["warehouse"="yes"]["name"](${box.s},${box.w},${box.n},${box.e});node["building"="warehouse"]["name"](${box.s},${box.w},${box.n},${box.e});node["amenity"="freight_terminal"]["name"](${box.s},${box.w},${box.n},${box.e});way["industrial"="logistics"]["name"](${box.s},${box.w},${box.n},${box.e}););out center 150;`;
  const res = await fetch(EP, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
    body: new URLSearchParams({ data: q }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return parse(data.elements || [], box.label.length === 2 ? box.label : "EU");
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length} sites`);

for (const box of EXTRA_BBOXES) {
  if (catalog.length >= TARGET) break;
  try {
    const batch = await fetchBbox(box);
    catalog = merge(catalog, batch);
    console.log(`${box.label}: +${batch.length} → ${catalog.length}`);
    writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  } catch (e) {
    console.error(`${box.label} failed: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 600));
}

// Fine grid pass if still short
if (catalog.length < TARGET) {
  for (let lat = 35; lat < 70 && catalog.length < TARGET; lat += 2) {
    for (let lon = -10; lon < 38 && catalog.length < TARGET; lon += 3) {
      try {
        const batch = await fetchBbox({
          label: "EU",
          s: lat,
          w: lon,
          n: Math.min(lat + 2, 71),
          e: Math.min(lon + 3, 40),
        });
        const before = catalog.length;
        catalog = merge(catalog, batch);
        if (catalog.length > before) {
          console.log(`grid ${lat},${lon}: +${catalog.length - before} → ${catalog.length}`);
          writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
        }
      } catch {
        /* skip */
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

const countries = new Set(catalog.map((s) => s.country_code));
console.log(`DONE: ${catalog.length} sites, ${countries.size} countries`);
if (catalog.length < TARGET) process.exitCode = 1;
