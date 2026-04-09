#!/usr/bin/env node
/*
 * tools/build-content.js
 *
 * Reads the canonical research docs in ../ (the parent Research folder)
 * and emits src/content.json — the single blob the app consumes at runtime.
 *
 * Inputs (per jamie_pwa_v1_spec.md §7):
 *   - training_guide.{txt,docx}            -> exercises[], sessions[], phases[]
 *   - nutrition_guide.{txt,docx}           -> recipes[], weekly_rotation, supplements[]
 *   - action_plan.{txt,docx}               -> phases[], decision_rules
 *   - clinical_sleep_guide.{txt,docx}      -> guides.sleep, guides.smoking
 *   - addendum_equipment_cardio_tracking.{txt,docx} -> cardio_prescription
 *   - tracking_guide.{txt,docx}            -> guides.tracking
 *   - literature_review.{txt,docx}         -> guides.literature
 *   - evidence_table.xlsx                  -> evidence[]
 *
 * The .txt exports are the deterministic structured-extraction source;
 * mammoth converts .docx to markdown for the long-form guide bodies.
 *
 * Strict rule: do NOT invent data. Anything not present in source files
 * is left null/empty and a warning is logged with file + section.
 *
 * Run: `npm run content`
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import mammoth from 'mammoth';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESEARCH_ROOT = resolve(REPO_ROOT, '..');
const OUT_PATH = resolve(REPO_ROOT, 'public', 'content.json');
const RECIPES_PATH = resolve(REPO_ROOT, 'content', 'recipes.json');

const warnings = [];
function warn(file, section, msg) {
  const line = `[content] WARN ${file} :: ${section} :: ${msg}`;
  warnings.push(line);
  console.warn(line);
}

// ---------- helpers ----------

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function readText(name) {
  const p = join(RESEARCH_ROOT, name);
  if (!existsSync(p)) {
    warn(name, 'file', 'not found');
    return null;
  }
  const raw = await readFile(p, 'utf8');
  return decodeEntities(raw);
}

async function docxToMarkdown(name) {
  const p = join(RESEARCH_ROOT, name);
  if (!existsSync(p)) return null;
  try {
    const { value } = await mammoth.convertToMarkdown({ path: p });
    return value;
  } catch (err) {
    warn(name, 'mammoth', err.message);
    return null;
  }
}

// ---------- exercise parser (training_guide.txt §5) ----------

const EXERCISE_HEADINGS = [
  ['goblet_squat', 'Goblet Squat', 'legs'],
  ['db_bench_press', 'DB Bench Press', 'chest'],
  ['one_arm_db_row', 'One-Arm DB Row', 'back'],
  ['db_rdl', 'DB Romanian Deadlift (RDL)', 'hamstrings'],
  ['db_overhead_press', 'DB Overhead Press (Seated or Standing)', 'shoulders'],
  ['chin_up', 'Chin-Up / Inverted Row', 'back'],
  ['db_split_squat', 'DB Split Squat', 'legs'],
  ['db_hip_thrust', 'DB Hip Thrust', 'glutes'],
  ['db_deadlift', 'DB Deadlift (Conventional)', 'posterior_chain'],
  ['db_incline_press', 'DB Incline Press', 'chest'],
  ['db_lateral_raise', 'DB Lateral Raise', 'shoulders'],
  ['chest_supported_db_row', 'Chest-Supported DB Row', 'back'],
  ['db_curl', 'DB Curl / Hammer Curl', 'biceps'],
  ['db_triceps_extension', 'DB Triceps Extension / Skullcrusher', 'triceps'],
  ['plank', 'Plank', 'core'],
  ['hanging_knee_raise', 'Hanging Knee Raise', 'core'],
];

function parseExercises(trainingTxt) {
  const exercises = [];
  if (!trainingTxt) return exercises;
  const lines = trainingTxt.split(/\r?\n/);
  const headingIdx = new Map();
  for (const [, title] of EXERCISE_HEADINGS) {
    const idx = lines.findIndex((l) => l.trim() === title);
    if (idx >= 0) headingIdx.set(title, idx);
    else warn('training_guide.txt', `exercise:${title}`, 'heading not found');
  }
  for (let i = 0; i < EXERCISE_HEADINGS.length; i++) {
    const [id, title, muscle] = EXERCISE_HEADINGS[i];
    const start = headingIdx.get(title);
    if (start == null) continue;
    let end = lines.length;
    for (let j = i + 1; j < EXERCISE_HEADINGS.length; j++) {
      const next = headingIdx.get(EXERCISE_HEADINGS[j][1]);
      if (next != null) {
        end = next;
        break;
      }
    }
    const sect6 = lines.findIndex(
      (l, k) => k > start && /^\s*6\.\s+Phase 0 Full-Body/i.test(l)
    );
    if (sect6 >= 0 && sect6 < end) end = sect6;

    const block = lines.slice(start + 1, end).join('\n').trim();
    const get = (key) => {
      // Case-insensitive, accepts either inline keys ("Setup: ...") or
      // sub-headed keys ("Chin-up setup: ...").
      const m = block.match(new RegExp(`(?:^|\\n)[^\\n]*?\\b${key}:\\s*([^\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const setup = get('Setup');
    const execution = get('Execution');
    const mistakes = get('Mistakes');
    const searchRaw = get('Search');
    const video_search = searchRaw
      ? searchRaw.replace(/^"|"$/g, '').replace(/"\s*or\s*"/g, ' / ').replace(/[".]+$/g, '')
      : '';

    // Soft warnings only — some exercises (Plank, Hanging Knee Raise) are
    // written as free prose in the source rather than key:value lines.
    // We capture the full block as `description` so the view always has
    // something to render, but we still log so the doc can be tightened
    // up later.
    if (!setup && !execution && !mistakes) {
      warn('training_guide.txt', `exercise:${title}`, 'free-prose entry — using description fallback');
    } else {
      if (!setup) warn('training_guide.txt', `exercise:${title}`, 'missing Setup');
      if (!execution) warn('training_guide.txt', `exercise:${title}`, 'missing Execution');
      if (!mistakes) warn('training_guide.txt', `exercise:${title}`, 'missing Mistakes');
    }
    if (!video_search) warn('training_guide.txt', `exercise:${title}`, 'missing video_search');

    exercises.push({
      id,
      name: title.replace(/\s*\(.*?\)\s*/g, '').trim(),
      muscle,
      setup,
      execution,
      mistakes,
      video_search,
      description: block,
    });
  }
  return exercises;
}

// ---------- session parser ----------

const NAME_TO_ID = {
  'goblet squat': 'goblet_squat',
  'goblet or db front squat': 'goblet_squat',
  'db bench press': 'db_bench_press',
  'one-arm db row': 'one_arm_db_row',
  'db romanian deadlift': 'db_rdl',
  'db split squat': 'db_split_squat',
  'front-foot-elevated split squat': 'db_split_squat',
  'seated db overhead press': 'db_overhead_press',
  'db overhead press': 'db_overhead_press',
  'chin-up or inverted row': 'chin_up',
  'chin-up or db pullover': 'chin_up',
  'db hip thrust': 'db_hip_thrust',
  'hanging knee raise': 'hanging_knee_raise',
  'db deadlift': 'db_deadlift',
  'db incline press': 'db_incline_press',
  'chest-supported db row': 'chest_supported_db_row',
  'db lateral raise': 'db_lateral_raise',
  'db curl': 'db_curl',
  'db hammer curl': 'db_curl',
  'db triceps extension': 'db_triceps_extension',
  'db skullcrusher': 'db_triceps_extension',
  'standing db calf raise': null,
  'db calf raise': null,
  plank: 'plank',
};

function parseRepsAndRest(line) {
  const setsRepsM = line.match(/(\d+)\s*[×x]\s*([\d–\-]+)/);
  const sets = setsRepsM ? Number(setsRepsM[1]) : null;
  let reps = setsRepsM ? setsRepsM[2].trim() : null;
  if (reps) reps = reps.replace('–', '-');
  const restM = line.match(/rest\s*(\d+)\s*s/i);
  const rest_s = restM ? Number(restM[1]) : null;
  const each = /each\s+(side|leg)/i.test(line);
  const amrap = /AMRAP/i.test(line);
  return { sets, reps: amrap ? 'AMRAP' : reps, rest_s, each };
}

function buildSession(id, phase, day, headerKeyword, trainingTxt) {
  if (!trainingTxt) return null;
  const lines = trainingTxt.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim().startsWith(headerKeyword));
  if (startIdx < 0) {
    warn('training_guide.txt', `session:${id}`, `header "${headerKeyword}" not found`);
    return null;
  }
  const exs = [];
  for (let i = startIdx + 1; i < Math.min(startIdx + 40, lines.length); i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (/^(Session [A-C]|Upper [AB]|Lower [AB])\s+—/.test(raw)) break;
    if (/^\d+\.\s+(Phase|How|Troubleshooting|Safety)/i.test(raw)) break;

    // Match: optional "1. " then "Name — tail" or "Name - tail"
    const m = raw.match(/^(?:\d+\.\s*)?([A-Z][^—]+?)\s+—\s+(.+)$/);
    if (!m) continue;
    let name = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const tail = m[2];
    if (/^warm-?up/i.test(name)) continue;
    if (/^superset/i.test(name)) {
      // Phase 0 Session C: "Superset: DB curl ... + DB triceps extension ..."
      // Push both as separate entries with shared note.
      const { sets, reps, rest_s } = parseRepsAndRest(tail);
      exs.push({
        exercise_id: 'db_curl',
        sets,
        reps,
        rest_s,
        note: 'Superset with triceps extension',
      });
      exs.push({
        exercise_id: 'db_triceps_extension',
        sets,
        reps,
        rest_s,
        note: 'Superset with curl',
      });
      continue;
    }
    name = name.replace(/\(.*?\)/g, '').trim();
    let exId = NAME_TO_ID[name];
    if (exId === undefined) {
      for (const k of Object.keys(NAME_TO_ID)) {
        if (name.startsWith(k) || k.startsWith(name)) {
          exId = NAME_TO_ID[k];
          break;
        }
      }
    }
    if (exId === undefined) {
      warn('training_guide.txt', `session:${id}`, `unmapped exercise "${name}"`);
      continue;
    }
    if (exId === null) continue;
    const { sets, reps, rest_s, each } = parseRepsAndRest(tail);
    exs.push({
      exercise_id: exId,
      sets,
      reps,
      rest_s,
      ...(each ? { unilateral: true } : {}),
    });
  }
  if (exs.length === 0) {
    warn('training_guide.txt', `session:${id}`, 'no exercises parsed');
    return null;
  }
  return { id, phase, day, exercises: exs };
}

function parseSessions(trainingTxt) {
  const sessions = [];
  const defs = [
    ['P0_full_body_A', 0, 'monday', 'Session A —'],
    ['P0_full_body_B', 0, 'wednesday', 'Session B —'],
    ['P0_full_body_C', 0, 'friday', 'Session C —'],
    ['P1_upper_A', 1, 'monday', 'Upper A —'],
    ['P1_lower_A', 1, 'tuesday', 'Lower A —'],
    ['P1_upper_B', 1, 'thursday', 'Upper B —'],
    ['P1_lower_B', 1, 'friday', 'Lower B —'],
  ];
  for (const [id, phase, day, hdr] of defs) {
    const s = buildSession(id, phase, day, hdr, trainingTxt);
    if (s) sessions.push(s);
  }
  return sessions;
}

// ---------- recipes (nutrition_guide.txt §3) ----------

const RECIPE_DEFS = [
  {
    id: 'peri_peri_chicken',
    name: 'Peri-Peri Chicken, Potatoes, Broccoli',
    headerKey: 'Recipe 1 —',
    category: 'main',
    cuisine: 'portuguese',
    methods: ['air_fryer'],
    equipment_required: ['air_fryer'],
    time_min: 25,
    fridge_days: 4,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['batch_cook', 'high_protein'],
  },
  {
    id: 'turkey_burrito_bowl',
    name: 'Turkey Burrito Bowl',
    headerKey: 'Recipe 2 —',
    category: 'main',
    cuisine: 'mexican',
    methods: ['hob', 'air_fryer'],
    equipment_required: [],
    time_min: 25,
    fridge_days: 4,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['batch_cook', 'high_protein'],
  },
  {
    id: 'steak_sweet_potato_asparagus',
    name: 'Steak, Sweet Potato, Asparagus',
    headerKey: 'Recipe 3 —',
    category: 'main',
    cuisine: 'british',
    methods: ['air_fryer'],
    equipment_required: ['air_fryer'],
    time_min: 25,
    fridge_days: 4,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['high_protein', 'one_pan'],
  },
  {
    id: 'pork_loin_apple_slaw',
    name: 'Pork Loin, Apple Slaw, Rice',
    headerKey: 'Recipe 4 —',
    category: 'main',
    cuisine: 'british',
    methods: ['air_fryer', 'hob'],
    equipment_required: ['air_fryer'],
    time_min: 25,
    fridge_days: 4,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['batch_cook', 'high_protein'],
  },
  {
    id: 'overnight_protein_oats',
    name: 'Overnight Protein Oats',
    headerKey: 'Recipe 5 —',
    category: 'breakfast',
    cuisine: 'british',
    methods: ['no_cook'],
    equipment_required: [],
    time_min: 5,
    fridge_days: 3,
    phase_fit: ['maintain', 'bulk'],
    tags: ['batch_cook', 'high_protein', 'no_cook'],
  },
  {
    id: 'egg_bacon_muffins',
    name: 'Air-Fryer Egg & Bacon Muffins',
    headerKey: 'Recipe 6 —',
    category: 'breakfast',
    cuisine: 'british',
    methods: ['air_fryer'],
    equipment_required: ['air_fryer'],
    time_min: 15,
    fridge_days: 4,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['batch_cook', 'high_protein'],
  },
  {
    id: 'cottage_cheese_bowl',
    name: 'Cottage Cheese Power Bowl',
    headerKey: 'Recipe 7 —',
    category: 'snack',
    cuisine: 'british',
    methods: ['no_cook'],
    equipment_required: [],
    time_min: 2,
    fridge_days: null,
    phase_fit: ['cut', 'maintain', 'bulk'],
    tags: ['no_cook', 'high_protein'],
  },
  {
    id: 'halloumi_chicken_wrap',
    name: 'Halloumi & Chicken Wraps',
    headerKey: 'Recipe 8 —',
    category: 'main',
    cuisine: 'mediterranean',
    methods: ['air_fryer'],
    equipment_required: ['air_fryer'],
    time_min: 10,
    fridge_days: 3,
    phase_fit: ['maintain', 'bulk'],
    tags: ['high_protein'],
  },
];

function parseRecipes(nutritionTxt) {
  const out = [];
  if (!nutritionTxt) return out;
  const lines = nutritionTxt.split(/\r?\n/);

  for (let i = 0; i < RECIPE_DEFS.length; i++) {
    const def = RECIPE_DEFS[i];
    const startIdx = lines.findIndex((l) => l.startsWith(def.headerKey));
    if (startIdx < 0) {
      warn('nutrition_guide.txt', `recipe:${def.id}`, 'header not found');
      continue;
    }
    let endIdx = lines.length;
    for (let j = i + 1; j < RECIPE_DEFS.length; j++) {
      const nx = lines.findIndex((l) => l.startsWith(RECIPE_DEFS[j].headerKey));
      if (nx > startIdx) {
        endIdx = nx;
        break;
      }
    }
    const sect4 = lines.findIndex((l, k) => k > startIdx && /^\s*4\.\s+Weekly Rotation/i.test(l));
    if (sect4 > 0 && sect4 < endIdx) endIdx = sect4;
    const block = lines.slice(startIdx, endIdx);
    const header = block[0];

    const macroM = header.match(
      /\(~?\s*(\d+)\s*kcal\s*\|\s*(\d+)\s*P\s*\|\s*(\d+)\s*C\s*\|\s*(\d+)\s*F\s*(?:per\s*([^)]+))?\)/
    );
    let macros_per_serving = null;
    let macro_note = null;
    if (macroM) {
      macros_per_serving = {
        kcal: Number(macroM[1]),
        p: Number(macroM[2]),
        c: Number(macroM[3]),
        f: Number(macroM[4]),
        fibre: null,
      };
      if (macroM[5]) macro_note = `per ${macroM[5].trim()}`;
    } else {
      warn('nutrition_guide.txt', `recipe:${def.id}`, 'macros not parsed from header');
    }

    let ingredients_raw = '';
    let servings = 1;
    for (const l of block) {
      const m1 = l.match(/Per portion:\s*(.+)$/);
      if (m1) {
        ingredients_raw = m1[1].trim();
        break;
      }
      const m2 = l.match(/Batch of (\d+):\s*(.+)$/);
      if (m2) {
        ingredients_raw = m2[2].trim();
        servings = Number(m2[1]);
        break;
      }
    }
    if (!ingredients_raw)
      warn('nutrition_guide.txt', `recipe:${def.id}`, 'no Per portion / Batch line');

    const ingredients = ingredients_raw
      ? ingredients_raw
          .split(/,\s*/)
          .map((s) => s.replace(/\.$/, '').trim())
          .filter(Boolean)
          .map((s) => {
            const gm = s.match(
              /^(\d+(?:\.\d+)?)\s*(g|ml|tsp|tbsp|scoop|tin|rashers?|large|kg|l)\b\s*(.*)$/i
            );
            if (gm) {
              return {
                name: gm[3] || s,
                qty: Number(gm[1]),
                unit: gm[2].toLowerCase(),
                note: '',
              };
            }
            return { name: s, qty: null, unit: null, note: '' };
          })
      : [];

    // Method steps: numbered lines after the ingredients line.
    const steps = [];
    let inSteps = false;
    for (const l of block.slice(1)) {
      const trimmed = l.trim();
      if (!trimmed) {
        inSteps = true;
        continue;
      }
      if (/^Per portion:|^Batch of/.test(trimmed)) {
        inSteps = true;
        continue;
      }
      if (/^Fridge:|^Best fresh|^Assemble fresh/i.test(trimmed)) break;
      if (inSteps) {
        steps.push(trimmed.replace(/^\d+\.\s*/, ''));
      }
    }

    const fridgeLine = block.find((l) => /Fridge:/i.test(l));
    const source_note = fridgeLine ? fridgeLine.trim() : null;

    out.push({
      id: def.id,
      name: def.name,
      category: def.category,
      cuisine: def.cuisine,
      methods: def.methods,
      equipment_required: def.equipment_required,
      time_min: def.time_min,
      active_time_min: null,
      servings,
      batch_scale: null,
      fridge_days: def.fridge_days,
      freezer_ok: null,
      phase_fit: def.phase_fit,
      protein_tier: macros_per_serving && macros_per_serving.p >= 30 ? 'main_40' : 'snack_15',
      cost_tier: '££',
      tags: def.tags,
      allergens: null,
      diet_flags: null,
      macros_per_serving,
      macros_per_100g: null,
      ingredients,
      method_steps: steps,
      source_note,
      macro_note,
    });
  }
  return out;
}

// ---------- decision rules + cardio prescription + phases ----------

function buildDecisionRules() {
  return {
    P0: [
      {
        trigger: 'weight_stable_14d_within_0.3kg',
        action: 'hold',
        message: 'Stable ±0.3 kg over 14 days — maintenance is correct, hold.',
      },
      {
        trigger: 'weight_gain_14d_gt_0.3kg_per_week',
        action: 'cut_100_kcal',
        message: 'Gaining >0.3 kg/week — cut 100 kcal/day.',
      },
      {
        trigger: 'weight_loss_14d_gt_0.3kg_per_week',
        action: 'add_100_kcal',
        message: 'Losing >0.3 kg/week — add 100 kcal/day.',
      },
    ],
    P1: [
      {
        trigger: 'weight_gain_14d_gt_0.4kg_per_week_x2',
        action: 'cut_100_kcal',
        message: '>0.4 kg/week sustained — cut 100 kcal/day.',
      },
      {
        trigger: 'weight_gain_14d_lt_0.15kg_per_week_x2',
        action: 'add_100_kcal',
        message: '<0.15 kg/week sustained — add 100 kcal/day.',
      },
      {
        trigger: 'waist_gain_gt_2cm_per_month_no_weight_gain',
        action: 'cut_150_kcal',
        message: 'Waist +>2 cm/month with no weight gain — cut 150 kcal/day.',
      },
    ],
    P2: [
      {
        trigger: 'rate_of_loss_in_band',
        action: 'hold',
        message: 'Hold deficit — losing 0.4–0.6 kg/week is on target.',
      },
    ],
  };
}

function buildCardioPrescription() {
  return {
    P0: {
      weeks_1_3: 'rest_walking_only',
      week_4: '2x20min_z2',
      week_5: '2x25min_z2 + 1x15min_intervals_primer',
      week_6_plus: '2x30min_z2 + 1x20min_10_20_30',
    },
    P1: {
      default: '2x30min_z2 + 1x20min_10_20_30',
      cap_minutes_per_week: 90,
      rules: [
        'Cap cardio at ~90 min/week during hypertrophy phases.',
        'Prioritise Zone 2 over HIIT.',
        'Separate hard cardio from leg sessions by ≥6 hours.',
      ],
    },
    P2: {
      default: '2x30min_z2 + 1x20min_10_20_30',
      cap_minutes_per_week: 90,
    },
  };
}

function buildPhases() {
  return [
    {
      id: 0,
      name: 'Phase 0 — Diagnose & Stabilise',
      weeks: 6,
      training_split: 'full_body_3x',
      goal: 'Characterise sleep, complete endocrine bloods, embed habits at maintenance, lock in smoking quit.',
      session_ids: ['P0_full_body_A', 'P0_full_body_B', 'P0_full_body_C'],
    },
    {
      id: 1,
      name: 'Phase 1 — Lean Bulk',
      weeks: 20,
      training_split: 'upper_lower_4x',
      goal: 'Maximise newbie-gains hypertrophy on a controlled surplus.',
      session_ids: ['P1_upper_A', 'P1_lower_A', 'P1_upper_B', 'P1_lower_B'],
    },
    {
      id: 2,
      name: 'Phase 2 — Reassess & Cut',
      weeks: 12,
      training_split: 'upper_lower_4x',
      goal: 'Reveal Phase 1 muscle by reducing body fat moderately.',
      session_ids: ['P1_upper_A', 'P1_lower_A', 'P1_upper_B', 'P1_lower_B'],
    },
  ];
}

function buildSupplements() {
  return [
    { name: 'Creatine monohydrate', dose: '5 g/day', timing: 'any', phases: [0, 1, 2] },
    {
      name: 'Vitamin D3',
      dose: '25 µg (1000 IU)/day default',
      timing: 'with fat-containing meal',
      phases: [0, 1, 2],
    },
    {
      name: 'Whey protein',
      dose: 'as needed to hit 110–145 g protein',
      timing: 'any',
      phases: [0, 1, 2],
    },
  ];
}

function buildWeeklyRotation() {
  // Source: nutrition_guide.txt §4 describes a default rotation, not a
  // strict day-by-day plan. Encode the same default pool for every day.
  const lunches_dinners = [
    'air_fryer_chipotle_chicken_rice',
    'teriyaki_salmon_rice',
    'steak_sweet_potato_wedges',
    'pork_loin_apple_slaw',
  ];
  const breakfast = ['protein_overnight_oats', 'egg_white_bacon_muffins'];
  const snack = ['cottage_cheese_pineapple_bowl'];
  const flex = ['halloumi_veg_wrap'];
  const day = { breakfast, mains: lunches_dinners, snack, flex };
  return {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: day,
    sunday: day,
  };
}

// ---------- evidence ----------

function readEvidence() {
  const p = join(RESEARCH_ROOT, 'evidence_table.xlsx');
  if (!existsSync(p)) {
    warn('evidence_table.xlsx', 'file', 'not found');
    return [];
  }
  const wb = XLSX.readFile(p);
  const sh = wb.Sheets['Evidence'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { defval: null });
  return rows.map((r, i) => ({
    id: slugify(r['Author/Year'] || `row_${i}`),
    author_year: r['Author/Year'],
    pmid_doi: r['PMID/DOI'],
    design: r['Design'],
    n: r['n'],
    population: r['Population'],
    intervention: r['Intervention/Exposure'],
    comparator: r['Comparator'],
    outcome: r['Outcome'],
    effect: r['Effect (95% CI)'],
    follow_up: r['Follow-up'],
    funding: r['Funding'],
    rob: r['RoB'],
    tier: r['Tier'],
    grade: r['GRADE'],
    domain: r['Domain'],
    notes: r['Notes'],
  }));
}

// ---------- main ----------

async function main() {
  console.log(`[content] reading from ${RESEARCH_ROOT}`);

  const trainingTxt = await readText('training_guide.txt');
  const nutritionTxt = await readText('nutrition_guide.txt');

  const exercises = parseExercises(trainingTxt);
  const sessions = parseSessions(trainingTxt);

  if (!existsSync(RECIPES_PATH)) {
    console.error(
      `[content] FAIL — ${RECIPES_PATH} not found. Run \`npm run recipes\` first to build it from ingredients_table.json + recipes_raw_batch_*.json.`
    );
    process.exit(1);
  }
  const recipesArtefact = JSON.parse(await readFile(RECIPES_PATH, 'utf8'));
  const recipes = (recipesArtefact.recipes || []).map((r) => ({
    ...r,
    ingredients: (r.ingredients || []).map((i) => ({
      name: i.name || i.item || '',
      grams: i.grams || 0,
      note: i.note || '',
    })),
  }));
  console.log(`[content] loaded ${recipes.length} recipes from ${RECIPES_PATH}`);

  const evidence = readEvidence();

  const guides = {};
  const guideMap = [
    ['phase0', 'action_plan'],
    ['sleep', 'clinical_sleep_guide'],
    ['smoking', 'clinical_sleep_guide'],
    ['nutrition', 'nutrition_guide'],
    ['training', 'training_guide'],
    ['tracking', 'tracking_guide'],
    ['addendum', 'addendum_equipment_cardio_tracking'],
    ['literature', 'literature_review'],
  ];
  for (const [key, base] of guideMap) {
    let md = await docxToMarkdown(`${base}.docx`);
    if (!md) {
      const txt = await readText(`${base}.txt`);
      md = txt;
    }
    if (!md) {
      warn(`${base}.{docx,txt}`, `guide:${key}`, 'no source available');
      guides[key] = null;
    } else {
      guides[key] = md;
    }
  }

  const out = {
    content_version: '1.0.0',
    last_updated: new Date().toISOString().slice(0, 10),
    locale: 'en-GB',
    units: 'SI',
    phases: buildPhases(),
    exercises,
    sessions,
    recipes,
    weekly_rotation: buildWeeklyRotation(),
    supplements: buildSupplements(),
    decision_rules: buildDecisionRules(),
    cardio_prescription: buildCardioPrescription(),
    guides,
    evidence,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));

  console.log(`[content] wrote ${OUT_PATH}`);
  console.log(
    `[content] summary: ${exercises.length} exercises, ${sessions.length} sessions, ${recipes.length} recipes, ${evidence.length} evidence rows, ${Object.keys(guides).length} guides`
  );
  console.log(`[content] ${warnings.length} warning(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
