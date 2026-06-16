#!/usr/bin/env node
/** Incremental tiled Overpass builder — saves after each tile (kill-safe). */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "european_logistics_sites.json");
const EMBED = join(__dirname, "..", "data", "_embedded_sites_seed.json");
const VERIFIED_AT = "2026-06-15";
const EP = "https://overpass.kumi.systems/api/interpreter";

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function merge(list) {
  const m = new Map();
  const c = new Set();
  for (const s of list) {
    const k = `${s.lat},${s.lon}`;
    if (c.has(k) || m.has(s.id)) continue;
    m.set(s.id, { ...s, verified_at: VERIFIED_AT });
    c.add(k);
  }
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function loadEmbedded() {
  const rows = JSON.parse(readFileSync(EMBED, "utf8"));
  return rows.map(([id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code, lat, lon]) => ({
    id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code,
    lat: +Number(lat).toFixed(5), lon: +Number(lon).toFixed(5),
    source: "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf",
    geocode_method: "nominatim",
  }));
}

const TILES = [];
for (let lat = 35; lat < 70; lat += 3) {
  for (let lon = -10; lon < 38; lon += 4) {
    TILES.push({ s: lat, w: lon, n: Math.min(lat + 3, 71), e: Math.min(lon + 4, 40) });
  }
}

async function fetchTile(tile) {
  const q = `[out:json][timeout:35];(node["industrial"="logistics"](${tile.s},${tile.w},${tile.n},${tile.e});node["landuse"="industrial"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["warehouse"="yes"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["building"="warehouse"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["amenity"="freight_terminal"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["man_made"="works"]["name"](${tile.s},${tile.w},${tile.n},${tile.e}););out body 80;`;
  const res = await fetch(EP, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
    body: new URLSearchParams({ data: q }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const el of data.elements || []) {
    if (!el.tags?.name || el.lat == null) continue;
    const tags = el.tags;
    const company = (tags.operator || tags.brand || tags.name.split(" ")[0]).split(";")[0].trim();
    const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "Unknown";
    const cc = (tags["addr:country"] || "EU").slice(0, 2).toUpperCase();
    out.push({
      id: slugify(`osm-${company}-${tags.name}-${city}-${el.id}`).slice(0, 120),
      company: company.slice(0, 60),
      facility_name: tags.name.slice(0, 120),
      facility_type: "contract_logistics_warehouse",
      address_line: tags["addr:street"] || null,
      postal_code: tags["addr:postcode"] || null,
      city,
      country_code: cc,
      lat: +el.lat.toFixed(5),
      lon: +el.lon.toFixed(5),
      source: `https://www.openstreetmap.org/node/${el.id}`,
      geocode_method: "osm_overpass",
    });
  }
  return out;
}

let all = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : loadEmbedded();
for (let i = 0; i < TILES.length; i++) {
  try {
    const batch = await fetchTile(TILES[i]);
    all = merge([...all, ...batch]);
    writeFileSync(OUT, JSON.stringify(all, null, 2) + "\n");
    process.stdout.write(`\r${i + 1}/${TILES.length} tiles, ${all.length} sites, ${new Set(all.map((s) => s.country_code)).size} countries`);
  } catch (e) {
    process.stdout.write(`\r${i + 1}/${TILES.length} FAIL ${e.message}                    `);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`\nWrote ${OUT} (${all.length} sites)`);
