/*
 * src/lib/content.js
 *
 * Typed accessors over src/content.json. The JSON is built by
 * tools/build-content.js from the canonical research docs in ../.
 *
 * Views (Train, Eat, Stats, Review) consume content exclusively through
 * this module so the JSON shape stays a single point of change.
 *
 * Loading model: content.json lives in public/ and is fetched at runtime
 * during app bootstrap (see main.js → loadContent()). This keeps ~500 KB
 * of data out of the JS bundle and lets the service worker update content
 * out-of-band via the stale-while-revalidate route in vite.config.js.
 *
 * Accessors below assume loadContent() has already resolved — main.js
 * awaits it before mounting the app, so views can consume synchronously.
 */

/** @type {object} the parsed content blob — populated by loadContent() */
export const content = {};

let _loadPromise = null;

export function loadContent() {
  if (_loadPromise) return _loadPromise;
  const url = `${import.meta.env.BASE_URL}content.json`;
  _loadPromise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`content.json ${r.status}`);
      return r.json();
    })
    .then((data) => {
      Object.assign(content, data);
      return content;
    });
  return _loadPromise;
}

// ---------- exercises ----------

/**
 * @param {string} id
 * @returns {object|null} exercise record or null if not found
 */
export function getExercise(id) {
  return (content.exercises || []).find((e) => e.id === id) || null;
}

export function getAllExercises() {
  return content.exercises || [];
}

// ---------- sessions ----------

/** @param {string} id */
export function getSession(id) {
  return (content.sessions || []).find((s) => s.id === id) || null;
}

/**
 * Resolve the session for a given phase + day-of-week.
 *
 * @param {number} phase  0 | 1 | 2
 * @param {number} dayOfWeek  0=Sun … 6=Sat (JS Date.getDay convention)
 * @returns {object|null}
 */
export function getSessionForToday(phase, dayOfWeek) {
  const phaseDef = (content.phases || []).find((p) => p.id === phase);
  if (!phaseDef) return null;
  const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    dayOfWeek
  ];
  // Find a session whose phase matches and whose day matches today.
  const direct = (content.sessions || []).find(
    (s) => s.phase === phase && s.day === dayName && phaseDef.session_ids.includes(s.id)
  );
  if (direct) return direct;
  // Fallback: no session scheduled for this day in this phase = rest day.
  return null;
}

export function getSessionsForPhase(phase) {
  return (content.sessions || []).filter((s) => s.phase === phase);
}

// ---------- recipes ----------

export function getRecipe(id) {
  return (content.recipes || []).find((r) => r.id === id) || null;
}

/**
 * @param {object} [filter]
 * @param {string} [filter.category]      breakfast | main | snack | side | drink
 * @param {string} [filter.cuisine]
 * @param {string} [filter.method]        air_fryer | hob | oven | ...
 * @param {string} [filter.phase_fit]     cut | maintain | bulk
 * @param {string} [filter.tag]
 * @param {number} [filter.maxTimeMin]
 * @param {string} [filter.query]         free-text on name
 */
export function getRecipesFiltered(filter = {}) {
  return (content.recipes || []).filter((r) => {
    if (filter.category && r.category !== filter.category) return false;
    if (filter.cuisine && r.cuisine !== filter.cuisine) return false;
    if (filter.method && !(r.methods || []).includes(filter.method)) return false;
    if (filter.phase_fit && !(r.phase_fit || []).includes(filter.phase_fit)) return false;
    if (filter.tag && !(r.tags || []).includes(filter.tag)) return false;
    if (filter.maxTimeMin != null && r.time_min != null && r.time_min > filter.maxTimeMin)
      return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      if (!r.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function getWeeklyRotation() {
  return content.weekly_rotation;
}

// ---------- evidence ----------

export function getEvidence(id) {
  return (content.evidence || []).find((e) => e.id === id) || null;
}

export function getAllEvidence() {
  return content.evidence || [];
}

// ---------- guides ----------

/**
 * @param {('phase0'|'sleep'|'smoking'|'nutrition'|'training'|'tracking'|'addendum'|'literature')} key
 * @returns {string|null} markdown body
 */
export function getGuide(key) {
  return content.guides ? content.guides[key] || null : null;
}

// ---------- decision rules + cardio ----------

/**
 * @param {number} phase
 * @returns {Array<object>}
 */
export function getDecisionRules(phase) {
  const key = `P${phase}`;
  return (content.decision_rules && content.decision_rules[key]) || [];
}

/**
 * @param {number} phase
 * @param {number} [week]  1-indexed week within the phase; only Phase 0 is week-sensitive.
 */
export function getCardioPrescription(phase, week) {
  const key = `P${phase}`;
  const node = content.cardio_prescription && content.cardio_prescription[key];
  if (!node) return null;
  if (phase !== 0) return node;
  if (!week || week <= 3) return { ...node, current: node.weeks_1_3, week };
  if (week === 4) return { ...node, current: node.week_4, week };
  if (week === 5) return { ...node, current: node.week_5, week };
  return { ...node, current: node.week_6_plus, week };
}

// ---------- supplements + phases ----------

export function getSupplements(phase) {
  if (phase == null) return content.supplements || [];
  return (content.supplements || []).filter((s) => !s.phases || s.phases.includes(phase));
}

export function getPhase(id) {
  return (content.phases || []).find((p) => p.id === id) || null;
}

export function getContentMeta() {
  return {
    content_version: content.content_version,
    last_updated: content.last_updated,
    locale: content.locale,
    units: content.units,
  };
}
