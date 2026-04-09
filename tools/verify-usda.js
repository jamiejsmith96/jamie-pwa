#!/usr/bin/env node
/*
 * tools/verify-usda.js [--apply]
 *
 * Re-fetches every ingredients_table.json entry with a non-null fdc_id
 * and flags any macro that has drifted by more than 2% (relative).
 * Exits non-zero if any drift is found (for monthly CI check).
 *
 * Pass --apply to write the fresh values back to ingredients_table.json.
 *
 * Env:
 *   FDC_API_KEY  — required
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './_env.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESEARCH_ROOT = resolve(__dirname, '..', '..');
const ING_PATH = join(RESEARCH_ROOT, 'ingredients_table.json');

const NUTRIENT_IDS = {
  kcal: '1008',
  protein_g: '1003',
  carbs_g: '1005',
  fat_g: '1004',
  fibre_g: '1079',
};
const FIELDS = Object.keys(NUTRIENT_IDS);
const DRIFT_THRESHOLD = 0.02; // 2%

function extractMacros(food) {
  const out = { kcal: null, protein_g: null, carbs_g: null, fat_g: null, fibre_g: null };
  for (const n of food.foodNutrients || []) {
    const number =
      (n.nutrient && n.nutrient.number) ||
      n.nutrientNumber ||
      (n.nutrient && String(n.nutrient.id));
    const value = n.amount != null ? n.amount : n.value != null ? n.value : null;
    if (number == null || value == null) continue;
    for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
      if (String(number) === id && out[key] == null) out[key] = Number(value);
    }
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) {
    console.error('[verify-usda] FDC_API_KEY environment variable is required but not set.');
    process.exit(2);
  }

  const raw = JSON.parse(await readFile(ING_PATH, 'utf8'));
  const entries = Object.entries(raw.ingredients || {}).filter(([, v]) => v && v.fdc_id);
  console.log(`[verify-usda] checking ${entries.length} entries with fdc_id`);

  const drifts = [];
  let checked = 0;

  for (const [name, entry] of entries) {
    const url = `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(entry.fdc_id)}?api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[verify-usda] WARN — ${name} (fdc ${entry.fdc_id}): HTTP ${res.status}`);
      continue;
    }
    const food = await res.json();
    const fresh = extractMacros(food);
    checked += 1;

    const fieldDrifts = [];
    for (const f of FIELDS) {
      const oldVal = Number(entry[f]);
      const newVal = fresh[f];
      if (newVal == null) continue;
      if (!isFinite(oldVal) || oldVal === 0) continue;
      const rel = Math.abs(newVal - oldVal) / Math.abs(oldVal);
      if (rel > DRIFT_THRESHOLD) {
        fieldDrifts.push({ f, oldVal, newVal, rel });
      }
    }
    if (fieldDrifts.length > 0) {
      drifts.push({ name, fdc_id: entry.fdc_id, fieldDrifts, fresh });
      for (const d of fieldDrifts) {
        console.log(
          `[verify-usda] DRIFT ${name} ${d.f}: ${d.oldVal} -> ${d.newVal} (${(d.rel * 100).toFixed(1)}%)`
        );
      }
    }
  }

  console.log(`[verify-usda] checked ${checked}, drifted ${drifts.length}`);

  if (apply && drifts.length > 0) {
    for (const d of drifts) {
      const entry = raw.ingredients[d.name];
      for (const f of FIELDS) {
        if (d.fresh[f] != null) entry[f] = d.fresh[f];
      }
      entry.fetched_on = new Date().toISOString().slice(0, 10);
    }
    await writeFile(ING_PATH, JSON.stringify(raw, null, 2));
    console.log(`[verify-usda] --apply: wrote ${drifts.length} updates to ${ING_PATH}`);
  }

  if (drifts.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
