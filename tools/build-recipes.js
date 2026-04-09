#!/usr/bin/env node
/*
 * tools/build-recipes.js
 *
 * Computes per-serving and per-100g macros for every recipe at build time
 * by joining recipes_raw_batch_*.json against ingredients_table.json.
 *
 * Inputs  (in ../, the Research folder):
 *   - ingredients_table.json
 *   - recipes_raw_batch_*.json   (glob; recipes_batch_1.json is deprecated)
 *
 * Output:
 *   - jamie-pwa/content/recipes.json
 *
 * Fails the build on any missing ingredient reference.
 * Warns (non-fatal) when computed protein < protein_tier floor.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESEARCH_ROOT = resolve(REPO_ROOT, '..');
const OUT_DIR = resolve(REPO_ROOT, 'content');
const OUT_PATH = join(OUT_DIR, 'recipes.json');

const PROTEIN_FLOORS = {
  main_40: 40,
  breakfast_30: 30,
  snack_15: 15,
};

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function loadIngredients() {
  const p = join(RESEARCH_ROOT, 'ingredients_table.json');
  const raw = JSON.parse(await readFile(p, 'utf8'));
  if (!raw.ingredients) {
    throw new Error(`[recipes] ingredients_table.json has no "ingredients" key`);
  }
  // Normalise to lowercase keys for lookup tolerance.
  const map = new Map();
  for (const [k, v] of Object.entries(raw.ingredients)) {
    map.set(k.toLowerCase().trim(), v);
  }
  return map;
}

async function loadRawRecipes() {
  const entries = await readdir(RESEARCH_ROOT);
  const files = entries
    .filter((f) => /^recipes_raw_batch_\d+\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`[recipes] no recipes_raw_batch_*.json files found in ${RESEARCH_ROOT}`);
  }
  const all = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(RESEARCH_ROOT, f), 'utf8'));
    if (!Array.isArray(raw.recipes)) {
      throw new Error(`[recipes] ${f} has no "recipes" array`);
    }
    for (const r of raw.recipes) all.push({ ...r, _source_file: f });
  }
  return all;
}

function computeRecipe(recipe, ingMap, missing) {
  let totals = { kcal: 0, p: 0, c: 0, f: 0, fibre: 0 };
  let totalGrams = 0;

  for (const ing of recipe.ingredients || []) {
    const rawName = ing.item ?? ing.name ?? '';
    const key = String(rawName).toLowerCase().trim();
    const entry = ingMap.get(key);
    if (!entry) {
      missing.push({ recipe: recipe.id, ingredient: rawName || '(empty)' });
      continue;
    }
    const g = Number(ing.grams) || 0;
    const factor = g / 100;
    totals.kcal += (entry.kcal || 0) * factor;
    totals.p += (entry.protein_g || 0) * factor;
    totals.c += (entry.carbs_g || 0) * factor;
    totals.f += (entry.fat_g || 0) * factor;
    totals.fibre += (entry.fibre_g || 0) * factor;
    totalGrams += g;
  }

  const servings = Number(recipe.servings) || 1;
  const macros_per_serving = {
    kcal: Math.round(totals.kcal / servings),
    p: round1(totals.p / servings),
    c: round1(totals.c / servings),
    f: round1(totals.f / servings),
    fibre: round1(totals.fibre / servings),
  };

  let macros_per_100g = { kcal: 0, p: 0, c: 0, f: 0, fibre: 0 };
  if (totalGrams > 0) {
    const k = 100 / totalGrams;
    macros_per_100g = {
      kcal: Math.round(totals.kcal * k),
      p: round1(totals.p * k),
      c: round1(totals.c * k),
      f: round1(totals.f * k),
      fibre: round1(totals.fibre * k),
    };
  }

  const serving_weight_g = Math.round(totalGrams / servings);

  return { macros_per_serving, macros_per_100g, serving_weight_g };
}

async function main() {
  console.log(`[recipes] reading sources from ${RESEARCH_ROOT}`);
  const ingMap = await loadIngredients();
  console.log(`[recipes] loaded ${ingMap.size} ingredients`);

  const rawRecipes = await loadRawRecipes();
  console.log(`[recipes] loaded ${rawRecipes.length} raw recipes`);

  const missing = [];
  const warnings = [];
  const built = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rawRecipes) {
    const computed = computeRecipe(r, ingMap, missing);

    // Protein-floor warning (non-fatal).
    const floor = PROTEIN_FLOORS[r.protein_tier];
    if (floor != null && computed.macros_per_serving.p < floor) {
      warnings.push(
        `[recipes] WARN ${r.id}: protein ${computed.macros_per_serving.p} g < ${floor} g floor for tier ${r.protein_tier}`
      );
    }

    const { _source_file, ...clean } = r;
    built.push({
      ...clean,
      serving_weight_g: computed.serving_weight_g,
      macros_per_serving: computed.macros_per_serving,
      macros_per_100g: computed.macros_per_100g,
      source_note: `Macros computed from ingredients_table.json on ${today}`,
    });
  }

  if (missing.length > 0) {
    console.error(`[recipes] FAIL — ${missing.length} missing ingredient reference(s):`);
    for (const m of missing) {
      console.error(`  - recipe "${m.recipe}" references ingredient "${m.ingredient}" (not in ingredients_table.json)`);
    }
    process.exit(1);
  }

  for (const w of warnings) console.warn(w);

  await mkdir(OUT_DIR, { recursive: true });
  const out = {
    schema: 'recipes_v1',
    generated_on: today,
    source_note: 'Macros computed from ingredients_table.json; do not hand-edit.',
    recipes: built,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(`[recipes] wrote ${OUT_PATH}`);
  console.log(`[recipes] summary: ${built.length} recipes built, ${warnings.length} protein-tier warning(s), 0 missing ingredients`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
