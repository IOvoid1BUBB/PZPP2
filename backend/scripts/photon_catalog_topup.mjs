#!/usr/bin/env node
/** Top-up catalog via Photon geocoder (warehouse/logistics queries per tile bbox). */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1090;
const VERIFIED_AT = "2026-06-15";

const QUERIES = ["logistics warehouse", "freight terminal", "distribution centre", "industrial park"];

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

function inferCc(lat, lon) {
  if (lat >= 49.4 && lat <= 51.6 && lon >= 2.5 && lon <= 6.5) return "BE";
  if (lat >= 49.4 && lat <= 50.2 && lon >= 5.7 && lon <= 6.5) return "LU";
  if (lat >= 53.8 && lat <= 56.5 && lon >= 20.8 && lon <= 27) return "LT";
  if (lat >= 55.6 && lat <= 58.1 && lon >= 20.8 && lon <= 28.3) return "LV";
  if (lat >= 57.5 && lat <= 59.8 && lon >= 21.5 && lon <= 28.2) return "EE";
  if (lat >= 44 && lat <= 52.5 && lon >= 22 && lon <= 40.5) return "UA";
  if (lat >= 45.4 && lat <= 48.5 && lon >= 26.5 && lon <= 30.5) return "MD";
  if (lat >= 34.5 && lat <= 35.8 && lon >= 32 && lon <= 34.8) return "CY";
  if (lat >= 35.7 && lat <= 36.1 && lon >= 14.1 && lon <= 14.7) return "MT";
  if (lat >= 35 && lat <= 71 && lon >= -11 && lon <= 40) return "EU";
  return "EU";
}

function parseFeature(f) {
  const [lon, lat] = f.geometry?.coordinates || [];
  if (lat == null || lon == null) return null;
  const p = f.properties || {};
  const name = p.name || p.street || p.city;
  if (!name || name.length < 3) return null;
  const city = p.city || p.district || p.county || "Unknown";
  const cc = (p.countrycode || inferCc(lat, lon)).toUpperCase();
  const company = (p.osm_value === "warehouse" ? "Warehouse" : p.osm_key === "industrial" ? "Industrial" : name.split(/[\s,]/)[0]).slice(0, 60);
  const osmId = p.osm_id || `${lat}-${lon}`;
  return {
    id: slugify(`photon-${company}-${name}-${city}-${cc}-${osmId}`).slice(0, 120),
    company,
    facility_name: String(name).slice(0, 120),
    facility_type: "contract_logistics_warehouse",
    address_line: [p.street, p.housenumber].filter(Boolean).join(" ") || null,
    postal_code: p.postcode || null,
    city,
    country_code: cc.length === 2 ? cc : inferCc(lat, lon),
    lat: +Number(lat).toFixed(5),
    lon: +Number(lon).toFixed(5),
    source: `https://photon.komoot.io/#?q=${encodeURIComponent(name)}`,
    geocode_method: "photon",
  };
}

async function searchBBox(w, s, e, n, q) {
  const params = new URLSearchParams({
    q,
    limit: "20",
    bbox: `${w},${s},${e},${n}`,
    lang: "en",
  });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { "User-Agent": "LoadmaxPZPP2-PhotonTopup/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map(parseFeature).filter(Boolean);
}

const tiles = [];
for (let lat = 35; lat < 70; lat += 2) {
  for (let lon = -10; lon < 38; lon += 3) {
    tiles.push({ s: lat, w: lon, n: Math.min(lat + 2, 71), e: Math.min(lon + 3, 40) });
  }
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

let tileIdx = 0;
for (const tile of tiles) {
  if (catalog.length >= TARGET) break;
  for (const q of QUERIES) {
    if (catalog.length >= TARGET) break;
    try {
      const hits = await searchBBox(tile.w, tile.s, tile.e, tile.n, q);
      const { catalog: next, added } = merge(catalog, hits);
      catalog = next;
      if (added > 0) console.log(`tile ${tile.s},${tile.w} "${q}": +${added} → ${catalog.length}`);
    } catch (e) {
      console.error(`FAIL ${tile.s},${tile.w}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  tileIdx++;
  if (tileIdx % 10 === 0) writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
const countries = new Set(catalog.map((s) => s.country_code));
console.log(`DONE: ${catalog.length} sites, ${countries.size} countries`);
if (catalog.length < TARGET) process.exitCode = 1;
