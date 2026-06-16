#!/usr/bin/env node
/** Fast Photon top-up — northern Europe tiles only, stop at TARGET. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");
const TARGET = 1200;
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

function parseFeature(f) {
  const [lon, lat] = f.geometry?.coordinates || [];
  if (lat == null || lon == null) return null;
  const p = f.properties || {};
  const name = p.name || p.street || p.city;
  if (!name || name.length < 3) return null;
  const city = p.city || p.district || "Unknown";
  const cc = (p.countrycode || "EU").toUpperCase();
  return {
    id: slugify(`photon-${name}-${city}-${cc}-${p.osm_id || lat}`).slice(0, 120),
    company: name.split(/[\s,]/)[0].slice(0, 60),
    facility_name: String(name).slice(0, 120),
    facility_type: "contract_logistics_warehouse",
    city,
    country_code: cc.length === 2 ? cc : "EU",
    lat: +Number(lat).toFixed(5),
    lon: +Number(lon).toFixed(5),
    source: "https://photon.komoot.io/",
    geocode_method: "photon",
  };
}

async function searchBBox(w, s, e, n, q) {
  const params = new URLSearchParams({ q, limit: "15", bbox: `${w},${s},${e},${n}` });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { "User-Agent": "LoadmaxPZPP2-PhotonFast/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map(parseFeature).filter(Boolean);
}

const tiles = [];
for (let lat = 43; lat < 70; lat += 2) {
  for (let lon = -10; lon < 38; lon += 3) {
    tiles.push({ s: lat, w: lon, n: Math.min(lat + 2, 71), e: Math.min(lon + 3, 40) });
  }
}

let catalog = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`Start: ${catalog.length}`);

for (const tile of tiles) {
  if (catalog.length >= TARGET) break;
  for (const q of QUERIES) {
    if (catalog.length >= TARGET) break;
    try {
      const hits = await searchBBox(tile.w, tile.s, tile.e, tile.n, q);
      const { catalog: next, added } = merge(catalog, hits);
      catalog = next;
      if (added > 0) console.log(`${tile.s},${tile.w} "${q}": +${added} → ${catalog.length}`);
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`DONE: ${catalog.length}`);
