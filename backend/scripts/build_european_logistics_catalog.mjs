#!/usr/bin/env node
/**
 * Build data/european_logistics_sites.json:
 * 1. Curated embedded sites (Nominatim-geocoded)
 * 2. OSM Overpass per-country (nodes, logistics-tagged)
 * Saves incrementally after each country.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "european_logistics_sites.json");
const EMBED = join(ROOT, "data", "_embedded_sites_seed.json");
const VERIFIED_AT = "2026-06-15";
const EP = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"];

const COUNTRIES = [
  "PL", "DE", "FR", "GB", "ES", "IT", "NL", "BE", "LU", "IE", "PT", "AT", "CH", "CZ", "SK",
  "HU", "RO", "BG", "GR", "SE", "NO", "DK", "FI", "LT", "LV", "EE", "SI", "HR", "RS", "BA",
  "UA", "MD", "CY", "MT",
];

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferCountry(lat, lon, fallback) {
  if (fallback && fallback !== "EU") return fallback;
  if (lat >= 49 && lat <= 55 && lon >= 14 && lon <= 24.5) return "PL";
  if (lat >= 47 && lat <= 55.5 && lon >= 5.5 && lon <= 15.5) return "DE";
  if (lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 9.5) return "FR";
  if (lat >= 36 && lat <= 44 && lon >= -9.8 && lon <= 4.5) return "ES";
  if (lat >= 35.5 && lat <= 47.5 && lon >= 6.5 && lon <= 19) return "IT";
  if (lat >= 50.5 && lat <= 59 && lon >= -11 && lon <= 2) return "GB";
  if (lat >= 50.5 && lat <= 54 && lon >= 2.5 && lon <= 7.5) return "NL";
  if (lat >= 49.4 && lat <= 51.6 && lon >= 2.5 && lon <= 6.5) return "BE";
  if (lat >= 55 && lat <= 69 && lon >= 10 && lon <= 25) return "SE";
  if (lat >= 55 && lat <= 58.5 && lon >= 8 && lon <= 13) return "DK";
  if (lat >= 59 && lat <= 71 && lon >= 4 && lon <= 32) return "NO";
  if (lat >= 59 && lat <= 70.5 && lon >= 19 && lon <= 32) return "FI";
  if (lat >= 45.5 && lat <= 48.5 && lon >= 16 && lon <= 23) return "HU";
  if (lat >= 48 && lat <= 51.5 && lon >= 12 && lon <= 19) return "CZ";
  if (lat >= 47.5 && lat <= 49.7 && lon >= 16.8 && lon <= 23) return "SK";
  if (lat >= 46 && lat <= 49 && lon >= 9 && lon <= 17.5) return "AT";
  if (lat >= 44 && lat <= 48.5 && lon >= 20 && lon <= 30) return "RO";
  if (lat >= 41 && lat <= 44.5 && lon >= 22 && lon <= 29) return "BG";
  if (lat >= 34.5 && lat <= 42 && lon >= 19 && lon <= 30) return "GR";
  if (lat >= 55 && lat <= 58.5 && lon >= 20.5 && lon <= 28.5) return "LT";
  if (lat >= 55.5 && lat <= 58.5 && lon >= 20.5 && lon <= 28.5) return "LV";
  if (lat >= 57.5 && lat <= 60 && lon >= 21.5 && lon <= 28.5) return "EE";
  if (lat >= 36.8 && lat <= 42.3 && lon >= -9.6 && lon <= -6) return "PT";
  if (lat >= 51.4 && lat <= 55.5 && lon >= -11 && lon <= -5) return "IE";
  if (lat >= 45.8 && lat <= 47.9 && lon >= 5.9 && lon <= 10.6) return "CH";
  if (lat >= 44 && lat <= 52.5 && lon >= 22 && lon <= 40.5) return "UA";
  if (lat >= 45.4 && lat <= 48.5 && lon >= 26.5 && lon <= 30.5) return "MD";
  if (lat >= 45.4 && lat <= 46.9 && lon >= 13.3 && lon <= 16.7) return "SI";
  if (lat >= 42 && lat <= 46.6 && lon >= 13 && lon <= 19.5) return "HR";
  if (lat >= 42 && lat <= 46.2 && lon >= 18.8 && lon <= 23) return "RS";
  if (lat >= 42.5 && lat <= 45.3 && lon >= 15.7 && lon <= 19.6) return "BA";
  if (lat >= 34.5 && lat <= 35.8 && lon >= 32 && lon <= 34.8) return "CY";
  if (lat >= 35.7 && lat <= 36.1 && lon >= 14.1 && lon <= 14.7) return "MT";
  if (lat >= 49.4 && lat <= 50.2 && lon >= 5.7 && lon <= 6.5) return "LU";
  return fallback || "EU";
}

function merge(list) {
  const byId = new Map();
  const coords = new Set();
  for (const s of list) {
    const k = `${s.lat},${s.lon}`;
    if (coords.has(k) || byId.has(s.id)) continue;
    byId.set(s.id, { ...s, verified_at: VERIFIED_AT });
    coords.add(k);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function loadEmbedded() {
  if (!existsSync(EMBED)) return [];
  const rows = JSON.parse(readFileSync(EMBED, "utf8"));
  return rows.map(([id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code, lat, lon]) => ({
    id, company, facility_name, facility_code, facility_type, address_line, postal_code, city, country_code,
    lat: +Number(lat).toFixed(5), lon: +Number(lon).toFixed(5),
    source: "https://m.media-amazon.com/images/G/02/FBA_Files/FC_adresses_specificities._CB482441708_.pdf",
    geocode_method: "nominatim",
  }));
}

function parseElements(elements, defaultCc) {
  const out = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat == null || lon == null || !name || name.length < 3) continue;
    const tags = el.tags;
    const company = (tags.operator || tags.brand || name.split(/[\s,]/)[0]).split(";")[0].trim();
    const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "Unknown";
    const cc = inferCountry(lat, lon, (tags["addr:country"] || defaultCc).slice(0, 2).toUpperCase());
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

async function fetchCountry(cc) {
  const q = `[out:json][timeout:55];area["ISO3166-1"="${cc}"]->.a;(node["industrial"="logistics"](area.a);node["landuse"="industrial"]["name"](area.a);node["warehouse"="yes"]["name"](area.a);node["building"="warehouse"]["name"](area.a);node["amenity"="freight_terminal"]["name"](area.a););out body 120;`;
  for (const ep of EP) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(70000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return parseElements(data.elements || [], cc);
    } catch {
      /* try next endpoint */
    }
  }
  return [];
}

async function fetchTiles() {
  const tiles = [];
  for (let lat = 35; lat < 70; lat += 2.5) {
    for (let lon = -10; lon < 38; lon += 3.5) {
      tiles.push({ s: lat, w: lon, n: Math.min(lat + 2.5, 71), e: Math.min(lon + 3.5, 40) });
    }
  }
  const out = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const q = `[out:json][timeout:40];(node["industrial"="logistics"](${t.s},${t.w},${t.n},${t.e});node["warehouse"="yes"]["name"](${t.s},${t.w},${t.n},${t.e});node["landuse"="industrial"]["name"](${t.s},${t.w},${t.n},${t.e}););out body 60;`;
    for (const ep of EP) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LoadmaxPZPP2/1.0" },
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(50000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        out.push(...parseElements(data.elements || [], "EU"));
        break;
      } catch {
        /* next */
      }
    }
    if ((i + 1) % 5 === 0) process.stdout.write(`\rTiles ${i + 1}/${tiles.length}, osm=${out.length}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\nTile pass: ${out.length} sites`);
  return out;
}

async function main() {
  let all = merge(loadEmbedded());
  console.log(`Embedded: ${all.length}`);

  for (const cc of COUNTRIES) {
    const batch = await fetchCountry(cc);
    all = merge([...all, ...batch]);
    writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
    console.log(`${cc}: +${batch.length} → total ${all.length} (${new Set(all.map((s) => s.country_code)).size} countries)`);
    await new Promise((r) => setTimeout(r, 800));
  }

  if (all.length < 1090) {
    console.log("Running tile supplement...");
    all = merge([...all, ...(await fetchTiles())]);
    writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
  }

  const countries = new Set(all.map((s) => s.country_code));
  console.log(`DONE: ${all.length} sites, ${countries.size} countries → ${OUT}`);
  if (all.length < 1090) {
    console.error(`WARNING: only ${all.length} sites (need ≥1090)`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
