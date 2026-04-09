/*
 * Meal suggestion engine — pluggable feature pipeline.
 *
 * Each feature is a pure function `(recipe, context) -> number in [-1, 1]`.
 * The final score is a weighted sum. v1 ships two active features
 * (fitsRemaining, kcalBudget). v2 features (timeOfDay, phaseAlignment,
 * variety, proteinTier) and v3 features (evidence, learned preference,
 * macroBalance) are registered as stubs returning 0 so they are part of
 * the pipeline shape but do not affect output until enabled.
 *
 * This lets later versions turn features on without touching the call site
 * or the Eat view.
 */

// ---------- v1 active features ----------

function featFitsRemaining(recipe, ctx) {
  const p = recipe.macros_per_serving?.p || 0;
  const remP = Math.max(1, ctx.remaining.p);
  // 1.0 = exactly fills the gap, >1 = overshoots, <1 = undershoots.
  // Cap at 1.5 so a 200g P bomb doesn't dominate when you only need 40g.
  const ratio = Math.min(1.5, p / remP);
  // Score peaks at ratio=1. Undershoots scale linearly; small overshoots OK.
  if (ratio >= 1) return 1 - (ratio - 1) * 0.5;
  return ratio;
}

function featKcalBudget(recipe, ctx) {
  const k = recipe.macros_per_serving?.kcal || 0;
  const remK = Math.max(1, ctx.remaining.kcal);
  // Penalty only — never rewards low kcal, that's not the point.
  if (k <= remK) return 0;
  const overshoot = (k - remK) / remK;
  return -Math.min(1, overshoot); // up to -1 if you'd double your budget
}

// ---------- v2 stubs (return 0 until implemented) ----------

function featTimeOfDay(_recipe, _ctx) {
  // v2: boost recipes whose category matches the current slot
  // (breakfast 6-10, mains 11-14 + 18-21, snack windows).
  return 0;
}

function featPhaseAlignment(_recipe, _ctx) {
  // v2: boost recipes with phase_fit matching settings.phase.
  // Cut -> lower kcal density, bulk -> higher, maintain -> balanced.
  return 0;
}

function featVariety(_recipe, _ctx) {
  // v2: penalise recipes already logged in loggedToday or the last 48h.
  return 0;
}

function featProteinTier(_recipe, _ctx) {
  // v2: bonus when recipe.protein_tier matches the active slot
  // (main_40 for mains, breakfast_30 for breakfast, snack_15 for snack).
  return 0;
}

// ---------- v3 stubs ----------

function featEvidenceTier(_recipe, _ctx) {
  // v3: recipes tagged with research evidence (Mediterranean pattern,
  // high-protein, high-fibre, etc.) get a bonus based on tier.
  return 0;
}

function featLearnedPreference(_recipe, _ctx) {
  // v3: weight shifts based on user's own log history — recipes they
  // actually log score higher, dismissed ones score lower.
  return 0;
}

function featMacroBalance(_recipe, _ctx) {
  // v3: keeps daily fibre, sat-fat, sodium, and C:F ratio within ranges.
  return 0;
}

// ---------- pipeline ----------

export const FEATURES = {
  fitsRemaining: { weight: 1.0, fn: featFitsRemaining, active: true },
  kcalBudget: { weight: 1.5, fn: featKcalBudget, active: true },
  timeOfDay: { weight: 0.8, fn: featTimeOfDay, active: false },
  phaseAlignment: { weight: 0.6, fn: featPhaseAlignment, active: false },
  variety: { weight: 0.4, fn: featVariety, active: false },
  proteinTier: { weight: 0.5, fn: featProteinTier, active: false },
  evidenceTier: { weight: 0.3, fn: featEvidenceTier, active: false },
  learnedPreference: { weight: 0.5, fn: featLearnedPreference, active: false },
  macroBalance: { weight: 0.4, fn: featMacroBalance, active: false },
};

export function scoreRecipe(recipe, ctx) {
  const breakdown = {};
  let total = 0;
  for (const [key, feat] of Object.entries(FEATURES)) {
    if (!feat.active) {
      breakdown[key] = 0;
      continue;
    }
    const raw = feat.fn(recipe, ctx);
    const weighted = raw * feat.weight;
    breakdown[key] = { raw, weighted };
    total += weighted;
  }
  return { total, breakdown };
}

export function suggestMeals(recipes, ctx, limit = 3) {
  return recipes
    .map((r) => {
      const { total, breakdown } = scoreRecipe(r, ctx);
      return { recipe: r, score: total, breakdown };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- full-day plan ----------

/**
 * Slot budget split — what share of the day's targets each slot should
 * deliver. Backed by meal-timing evidence: protein spread across 3–4
 * meals beats bolus; breakfast + 2 mains carry most of the load;
 * snack bridges. These ratios are deliberately conservative and will
 * be learnable in v3.
 */
const SLOT_SPLIT = {
  breakfast: { p: 0.25, kcal: 0.22 },
  lunch: { p: 0.3, kcal: 0.33 },
  snack: { p: 0.1, kcal: 0.1 },
  dinner: { p: 0.35, kcal: 0.35 },
};

const SLOT_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'];

function recipeMatchesSlot(recipe, slot) {
  const cat = (recipe.category || '').toLowerCase();
  if (slot === 'breakfast') return cat === 'breakfast';
  if (slot === 'snack') return cat === 'snack';
  // lunch + dinner both pull from mains (and side/drink are excluded)
  return cat === 'main' || cat === 'mains';
}

/**
 * Score a recipe for a specific slot, against that slot's share of the
 * remaining daily budget. Same scoring engine, just different `remaining`.
 */
function scoreForSlot(recipe, slot, slotRemaining, ctx) {
  const slotCtx = {
    ...ctx,
    slot,
    remaining: { ...ctx.remaining, p: slotRemaining.p, kcal: slotRemaining.kcal },
  };
  return scoreRecipe(recipe, slotCtx);
}

/**
 * Build a full-day plan: one recipe per slot (breakfast/lunch/snack/dinner)
 * chosen so their sum best approximates the daily target, respecting what's
 * already been logged today. Slots whose eaten total already matches or
 * exceeds their share are marked `done` and carry the logged meals through
 * unchanged.
 *
 * Greedy pick per slot (fast, deterministic). v3 can swap this for a
 * combinatorial optimiser that considers slot interactions, but the
 * return shape stays the same.
 */
export function suggestDayPlan(recipes, ctx) {
  const { targets, eaten, loggedToday } = ctx;

  // Group logged meals by inferred slot so we show what's already done.
  const loggedBySlot = { breakfast: [], lunch: [], snack: [], dinner: [] };
  for (const log of loggedToday || []) {
    const slot = inferSlotFromLog(log);
    loggedBySlot[slot].push(log);
  }

  // How much of the day's P/kcal has each slot already contributed?
  const slotEaten = {};
  for (const slot of SLOT_ORDER) {
    slotEaten[slot] = loggedBySlot[slot].reduce(
      (acc, l) => ({ p: acc.p + (l.p || 0), kcal: acc.kcal + (l.kcal || 0) }),
      { p: 0, kcal: 0 },
    );
  }

  const plan = [];
  const usedIds = new Set((loggedToday || []).map((l) => l.recipe_id).filter(Boolean));

  for (const slot of SLOT_ORDER) {
    const share = SLOT_SPLIT[slot];
    const slotTargetP = targets.p * share.p;
    const slotTargetK = targets.kcal * share.kcal;
    const slotRemP = Math.max(0, slotTargetP - slotEaten[slot].p);
    const slotRemK = Math.max(0, slotTargetK - slotEaten[slot].kcal);

    // Already hit (or overshot) this slot's share? Treat as done.
    const done = loggedBySlot[slot].length > 0 && slotRemP < 5;

    if (done) {
      plan.push({
        slot,
        label: slotLabel(slot),
        status: 'done',
        logged: loggedBySlot[slot],
        targetP: slotTargetP,
        targetKcal: slotTargetK,
      });
      continue;
    }

    // Pick the best-scoring recipe that matches the slot category and isn't
    // already used today (variety, even pre-v2).
    const candidates = recipes.filter((r) => recipeMatchesSlot(r, slot) && !usedIds.has(r.id));
    if (candidates.length === 0) {
      plan.push({
        slot,
        label: slotLabel(slot),
        status: loggedBySlot[slot].length ? 'partial' : 'empty',
        logged: loggedBySlot[slot],
        targetP: slotTargetP,
        targetKcal: slotTargetK,
      });
      continue;
    }

    const scored = candidates
      .map((r) => ({
        recipe: r,
        ...scoreForSlot(r, slot, { p: slotRemP, kcal: slotRemK }, ctx),
      }))
      .sort((a, b) => b.total - a.total);

    const pick = scored[0];
    usedIds.add(pick.recipe.id);

    plan.push({
      slot,
      label: slotLabel(slot),
      status: loggedBySlot[slot].length ? 'partial' : 'suggested',
      logged: loggedBySlot[slot],
      suggestion: pick.recipe,
      breakdown: pick.breakdown,
      alternatives: scored.slice(1, 4).map((s) => s.recipe),
      targetP: slotTargetP,
      targetKcal: slotTargetK,
    });
  }

  // Day-level totals from the plan (eaten + suggested)
  const totals = plan.reduce(
    (acc, entry) => {
      const eatenP = entry.logged.reduce((a, l) => a + (l.p || 0), 0);
      const eatenK = entry.logged.reduce((a, l) => a + (l.kcal || 0), 0);
      const suggP = entry.suggestion?.macros_per_serving?.p || 0;
      const suggK = entry.suggestion?.macros_per_serving?.kcal || 0;
      acc.p += eatenP + (entry.status === 'suggested' || entry.status === 'partial' ? suggP : 0);
      acc.kcal += eatenK + (entry.status === 'suggested' || entry.status === 'partial' ? suggK : 0);
      return acc;
    },
    { p: 0, kcal: 0 },
  );

  return {
    plan,
    projected: totals,
    targets,
    eaten,
  };
}

function inferSlotFromLog(log) {
  // Prefer explicit category if stored; fall back to timestamp window.
  const cat = (log.category || '').toLowerCase();
  if (cat === 'breakfast') return 'breakfast';
  if (cat === 'snack') return 'snack';
  if (cat === 'main' || cat === 'mains') {
    const h = log.datetime ? new Date(log.datetime).getHours() : 12;
    return h < 15 ? 'lunch' : 'dinner';
  }
  const h = log.datetime ? new Date(log.datetime).getHours() : 12;
  return currentSlot(new Date(log.datetime || Date.now()));
}

// ---------- context builder ----------

/**
 * Determine the current meal slot from clock time. v1 uses this only for
 * display labels; v2 timeOfDay feature uses it for scoring.
 */
export function currentSlot(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 17) return 'snack';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack'; // late night / early morning
}

export function slotLabel(slot) {
  return (
    {
      breakfast: 'Breakfast',
      lunch: 'Lunch',
      snack: 'Snack',
      dinner: 'Dinner',
    }[slot] || 'Next meal'
  );
}

/**
 * Build the context object passed to every feature function. Centralised so
 * v2/v3 features can rely on a stable shape without the caller changing.
 */
export function buildSuggestContext({ settings, eaten, loggedToday, now = new Date() }) {
  const proteinTarget = settings.protein_target_g || 120;
  const kcalTarget = settings.kcal_target || 2400;
  return {
    now,
    hourOfDay: now.getHours(),
    slot: currentSlot(now),
    phase: settings.phase,
    targets: { p: proteinTarget, kcal: kcalTarget },
    eaten: { ...eaten },
    remaining: {
      p: Math.max(0, proteinTarget - (eaten.p || 0)),
      kcal: Math.max(0, kcalTarget - (eaten.kcal || 0)),
      c: 0,
      f: 0,
    },
    loggedToday: loggedToday || [],
    // v3 placeholders — populated when features activate
    weightTrend14d: null,
    userHistory: null,
  };
}

/**
 * Human-readable one-liner explaining why these picks. Shown under the slot
 * label on the Eat view. Updated automatically as features activate.
 */
export function explainContext(ctx) {
  const bits = [];
  if (ctx.remaining.p > 0) bits.push(`${Math.round(ctx.remaining.p)}g protein left`);
  if (ctx.remaining.kcal > 0) bits.push(`${Math.round(ctx.remaining.kcal)} kcal left`);
  const phase = ctx.phase;
  if (phase != null) bits.push(`phase ${phase}`);
  if (bits.length === 0) return "You've hit your targets.";
  return `Top picks — ${bits.join(' · ')}.`;
}
