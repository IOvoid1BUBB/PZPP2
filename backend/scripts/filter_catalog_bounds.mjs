#!/usr/bin/env node
/** Remove catalog entries outside European bounds (lat 35–71, lon -10–40). */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "european_logistics_sites.json");

function inBounds(s) {
  return s.lat >= 35 && s.lat <= 71 && s.lon >= -10 && s.lon <= 40;
}

const catalog = JSON.parse(readFileSync(OUT, "utf8"));
const filtered = catalog.filter(inBounds);
const removed = catalog.length - filtered.length;
writeFileSync(OUT, `${JSON.stringify(filtered, null, 2)}\n`);
console.log(`Removed ${removed} out-of-bounds sites → ${filtered.length} remaining`);
