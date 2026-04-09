#!/usr/bin/env node
/*
 * tools/fetch-usda.js <name> <fdc_id>
 *
 * Build-time ingestion tool. Fetches a single food entry from USDA
 * FoodData Central and upserts it into ../ingredients_table.json.
 *
 * Never called by the PWA at runtime.
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

// USDA nutrient numbers.
const NUTRIENT_IDS = {
  kcal: '1008',
  protein_g: '1003',
  carbs_g: '1005',
  fat_g: '1004',
  fibre_g: '1079',
};

function extractMacros(food) {
  const out = { kcal: null, protein_g: null, carbs_g: null, fat_g: null, fibre_g: null };
  const nutrients = food.foodNutrients || [];
  for (const n of nutrients) {
    // The shape varies between endpoints; cover the common cases.
    const number =
      (n.nutrient && n.nutrient.number) ||
      n.nutrientNumber ||
      (n.nutrient && String(n.nutrient.id));
    const value =
      n.amount != null
        ? n.amount
        : n.value != null
          ? n.value
          : null;
    if (number == null || value == null) continue;
    for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
      if (String(number) === id && out[key] == null) {
        out[key] = Number(value);
      }
    }
  }
  return out;
}

async function main() {
  const [, , nameArg, fdcIdArg] = process.argv;
  if (!nameArg || !fdcIdArg) {
    console.error('Usage: node tools/fetch-usda.js <name> <fdc_id>');
    process.exit(2);
  }
  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) {
    console.error('[fetch-usda] FDC_API_KEY environment variable is required but not set.');
    process.exit(2);
  }

  const url = `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(fdcIdArg)}?api_key=${encodeURIComponent(apiKey)}`;
  console.log(`[fetch-usda] GET ${url.replace(apiKey, '***')}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[fetch-usda] FAIL — HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const food = await res.json();
  const macros = extractMacros(food);

  const missing = Object.entries(macros).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length > 0) {
    console.warn(`[fetch-usda] WARN — missing nutrients: ${missing.join(', ')}`);
  }

  const raw = JSON.parse(await readFile(ING_PATH, 'utf8'));
  raw.ingredients = raw.ingredients || {};

  // Case-insensitive exact match on existing key.
  const wantKey = nameArg.toLowerCase().trim();
  let matchKey = null;
  for (const k of Object.keys(raw.ingredients)) {
    if (k.toLowerCase().trim() === wantKey) {
      matchKey = k;
      break;
    }
  }
  const targetKey = matchKey || nameArg;
  const prev = raw.ingredients[targetKey] || { per: '100g' };

  raw.ingredients[targetKey] = {
    ...prev,
    kcal: macros.kcal ?? prev.kcal ?? null,
    protein_g: macros.protein_g ?? prev.protein_g ?? null,
    carbs_g: macros.carbs_g ?? prev.carbs_g ?? null,
    fat_g: macros.fat_g ?? prev.fat_g ?? null,
    fibre_g: macros.fibre_g ?? prev.fibre_g ?? null,
    per: '100g',
    fdc_id: fdcIdArg,
    fetched_on: new Date().toISOString().slice(0, 10),
    verified: true,
  };

  await writeFile(ING_PATH, JSON.stringify(raw, null, 2));
  console.log(`[fetch-usda] ${matchKey ? 'updated' : 'created'} "${targetKey}" (fdc_id ${fdcIdArg})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
