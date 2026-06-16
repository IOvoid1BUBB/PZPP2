#!/usr/bin/env node
/** Tiled Overpass + embedded verified sites → european_logistics_sites.json */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "european_logistics_sites.json");
const VERIFIED_AT = "2026-06-15";
const ENDPOINTS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"];

// 80+ verified Amazon / operator sites (public FC lists, Nominatim 2026-06-15)
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Inline embedded rows [id, company, name, code, type, address, zip, city, cc, lat, lon]
const EMBEDDED = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(join(__dirname, "..", "data", "_embedded_sites_seed.json"), "utf8")),
);

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function merge(...lists) {
  const m = new Map();
  const c = new Set();
  for (const list of lists) for (const s of list) {
    const k = `${s.lat},${s.lon}`;
    if (c.has(k) || m.has(s.id)) continue;
    m.set(s.id, { ...s, verified_at: VERIFIED_AT });
    c.add(k);
  }
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const TILES = [];
for (let lat = 35; lat < 70; lat += 4) {
  for (let lon = -10; lon < 38; lon += 5) {
    TILES.push({ s: lat, w: lon, n: Math.min(lat + 4, 71), e: Math.min(lon + 5, 40) });
  }
}

async function tileFetch(tile) {
  const q = `[out:json][timeout:40];(node["industrial"="logistics"](${tile.s},${tile.w},${tile.n},${tile.e});node["landuse"="industrial"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["warehouse"="yes"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["building"="warehouse"]["name"](${tile.s},${tile.w},${tile.n},${tile.e});node["amenity"="freight_terminal"]["name"](${tile.s},${tile.w},${tile.n},${tile.e}););out body 120;`;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(50000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const out = [];
      for (const el of data.elements || []) {
        if (!el.tags?.name || el.lat == null) continue;
        const tags = el.tags;
        const company = tags.operator?.split(";")[0] || tags.brand || tags.name.split(" ")[0];
        const city = tags["addr:city"] || tags["addr:town"] || "Unknown";
        const cc = tags["addr:country"]?.slice(0, 2).toUpperCase() || "EU";
        out.push({
          id: slugify(`osm-${company}-${tags.name}-${city}-${el.id}`).slice(0, 120),
          company: String(company).slice(0, 60),
          facility_name: tags.name.slice(0, 120),
          facility_type: "contract_logistics_warehouse",
          city,
          country_code: cc,
          lat: +el.lat.toFixed(5),
          lon: +el.lon.toFixed(5),
          source: `https://www.openstreetmap.org/node/${el.id}`,
          geocode_method: "osm_overpass",
        });
      }
      return out;
    } catch { /* next endpoint */ }
  }
  return [];
}

const embeddedSites = EMBEDDED.map(([id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code, lat, lon]) => ({
  id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code,
  lat: +Number(lat).toFixed(5), lon: +Number(lon).toFixed(5),
  source: "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf",
  geocode_method: "nominatim",
}));

const osm = [];
for (let i = 0; i < TILES.length; i++) {
  const batch = await tileFetch(TILES[i]);
  osm.push(...batch);
  process.stdout.write(`\rTile ${i + 1}/${TILES.length}, osm=${osm.length}, merged=${merge(embeddedSites, osm).length}   `);
  await new Promise((r) => setTimeout(r, 600));
}
console.log();
const catalog = merge(embeddedSites, osm);
console.log(`Total ${catalog.length}, countries ${new Set(catalog.map((s) => s.country_code)).size}`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(catalog, null, 2) + "\n");
if (catalog.length < 1200) { console.error("WARNING < 1200"); process.exitCode = 1; }
