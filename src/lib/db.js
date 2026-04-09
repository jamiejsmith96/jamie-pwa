/*
 * Jamie PWA — IndexedDB wrapper (idb)
 *
 * v1 schema from jamie_pwa_v1_spec.md section 6.
 * Every store uses the key named in the spec. Where the spec uses a
 * composite row (training_log, nutrition_log, cardio_log) we key by `id`
 * and add secondary indexes on date/datetime for fast range queries.
 *
 * Migrations are version-gated: bump DB_VERSION on every schema change and
 * add a case in the upgrade block. Old data is never dropped silently.
 */

import { openDB } from 'idb';

export const DB_NAME = 'jamie';
export const DB_VERSION = 1;

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // daily_log — keyed by YYYY-MM-DD date string
          db.createObjectStore('daily_log', { keyPath: 'date' });

          // training_log — one row per set
          const tl = db.createObjectStore('training_log', { keyPath: 'id' });
          tl.createIndex('by_session', 'session_id');
          tl.createIndex('by_datetime', 'datetime');
          tl.createIndex('by_exercise', 'exercise_id');

          // session_log — one row per training session
          const sl = db.createObjectStore('session_log', { keyPath: 'id' });
          sl.createIndex('by_date', 'date');

          // nutrition_log — one row per meal/food entry
          const nl = db.createObjectStore('nutrition_log', { keyPath: 'id' });
          nl.createIndex('by_datetime', 'datetime');

          // cardio_log — one row per cardio session
          const cl = db.createObjectStore('cardio_log', { keyPath: 'id' });
          cl.createIndex('by_datetime', 'datetime');

          // reviews — one row per Sunday review
          db.createObjectStore('reviews', { keyPath: 'date' });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- daily_log helpers ----------

export async function getDailyLog(date) {
  const db = await getDB();
  return (await db.get('daily_log', date)) || null;
}

export async function putDailyLog(row) {
  if (!row || !row.date) throw new Error('daily_log row requires a date');
  const db = await getDB();
  const existing = (await db.get('daily_log', row.date)) || {};
  const merged = { ...existing, ...row, updated_at: new Date().toISOString() };
  await db.put('daily_log', merged);
  return merged;
}

export async function updateDailyLogField(date, field, value) {
  return putDailyLog({ date, [field]: value });
}

export async function getAllDailyLogs() {
  const db = await getDB();
  return db.getAll('daily_log');
}

// ---------- persistent storage ----------

export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { supported: false, persisted: false };
  }
  try {
    const already = await navigator.storage.persisted();
    if (already) return { supported: true, persisted: true };
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: false };
  }
}

// ---------- training helpers ----------

const IN_PROGRESS_KEY = 'jamie.in_progress_session';

/**
 * Most recent completed set for an exercise (any session).
 * @param {string} exerciseId
 */
export async function getLastSetForExercise(exerciseId) {
  const db = await getDB();
  const idx = db.transaction('training_log').store.index('by_exercise');
  const cursor = await idx.openCursor(exerciseId, 'prev');
  if (!cursor) return null;
  return cursor.value;
}

/**
 * All session_log rows for the ISO-week containing `ref`.
 * Week starts Monday (en-GB).
 * @param {Date} [ref]
 */
export async function getSessionsThisWeek(ref = new Date()) {
  const day = ref.getDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const y = (d) => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  const db = await getDB();
  const range = IDBKeyRange.bound(y(monday), y(sunday));
  return db.getAllFromIndex('session_log', 'by_date', range);
}

/**
 * Look up the programmed session for a phase + dayOfWeek. Defers to
 * content.js via the caller — we only exist to provide a consistent name.
 * @param {number} phase
 * @param {number} dayOfWeek 0=Sun .. 6=Sat
 */
export async function getTodaysSession(phase, dayOfWeek) {
  const { getSessionForToday } = await import('./content.js');
  return getSessionForToday(phase, dayOfWeek);
}

export function saveInProgressSession(obj) {
  try {
    localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify(obj));
  } catch {
    /* ignore quota errors */
  }
}

export function loadInProgressSession() {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearInProgressSession() {
  try {
    localStorage.removeItem(IN_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Commit a completed session: one session_log row + N training_log rows.
 * @param {{session_log: object, training_log_rows: object[]}} payload
 */
export async function saveCompletedSession({ session_log, training_log_rows }) {
  if (!session_log?.id) throw new Error('session_log requires id');
  const db = await getDB();
  const tx = db.transaction(['session_log', 'training_log'], 'readwrite');
  await tx.objectStore('session_log').put(session_log);
  const tl = tx.objectStore('training_log');
  for (const row of training_log_rows || []) {
    if (!row.id) row.id = uuid();
    await tl.put(row);
  }
  await tx.done;
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return session_log;
}

// ---------- cardio helpers ----------

export async function addCardioLog(row) {
  const db = await getDB();
  const full = { id: row.id || uuid(), ...row };
  await db.put('cardio_log', full);
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return full;
}

export async function getAllCardioLogs() {
  const db = await getDB();
  return db.getAll('cardio_log');
}

// ---------- nutrition helpers ----------

export async function addNutritionLog(row) {
  const db = await getDB();
  const full = { id: row.id || uuid(), ...row };
  if (!full.datetime) full.datetime = new Date().toISOString();
  await db.put('nutrition_log', full);
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return full;
}

export async function getAllNutritionLogs() {
  const db = await getDB();
  return db.getAll('nutrition_log');
}

export async function deleteNutritionLog(id) {
  const db = await getDB();
  await db.delete('nutrition_log', id);
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
}

export async function getNutritionLogsForDate(date) {
  const db = await getDB();
  const all = await db.getAll('nutrition_log');
  return all.filter((r) => (r.datetime || '').slice(0, 10) === date);
}

export async function getNutritionLogsRange(from, to) {
  const db = await getDB();
  const all = await db.getAll('nutrition_log');
  return all.filter((r) => {
    const d = (r.datetime || '').slice(0, 10);
    return d >= from && d <= to;
  });
}

// ---------- reviews ----------

export async function addReview(row) {
  if (!row?.date) throw new Error('review requires a date');
  const db = await getDB();
  await db.put('reviews', row);
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return row;
}

export async function getReviews() {
  const db = await getDB();
  return db.getAll('reviews');
}

export async function getLatestReview() {
  const all = await getReviews();
  return all.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

// ---------- training range helpers ----------

export async function getAllTrainingLogs() {
  const db = await getDB();
  return db.getAll('training_log');
}

export async function getAllSessionLogs() {
  const db = await getDB();
  return db.getAll('session_log');
}

// ---------- backup / restore ----------

const STORES = [
  'daily_log',
  'training_log',
  'session_log',
  'nutrition_log',
  'cardio_log',
  'reviews',
];

export async function exportAllStores() {
  const db = await getDB();
  const out = { schema_version: DB_VERSION, exported_at: new Date().toISOString() };
  for (const s of STORES) out[s] = await db.getAll(s);
  try {
    out.settings = JSON.parse(localStorage.getItem('jamie.settings.v1') || 'null');
  } catch {
    out.settings = null;
  }
  return out;
}

export async function previewImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid backup');
  const db = await getDB();
  const diff = { new: {}, conflicts: {}, total_new: 0, total_conflicts: 0 };
  for (const s of STORES) {
    const incoming = Array.isArray(obj[s]) ? obj[s] : [];
    const existing = await db.getAll(s);
    const keyPath = s === 'daily_log' || s === 'reviews' ? 'date' : 'id';
    const existingKeys = new Set(existing.map((r) => r[keyPath]));
    let n = 0;
    let c = 0;
    for (const r of incoming) {
      if (existingKeys.has(r[keyPath])) c++;
      else n++;
    }
    diff.new[s] = n;
    diff.conflicts[s] = c;
    diff.total_new += n;
    diff.total_conflicts += c;
  }
  return diff;
}

export async function importAllStores(obj, mode = 'merge') {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid backup');
  const db = await getDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const incoming = Array.isArray(obj[s]) ? obj[s] : [];
    const store = tx.objectStore(s);
    if (mode === 'replace') await store.clear();
    for (const r of incoming) await store.put(r);
  }
  await tx.done;
  if (obj.settings && mode === 'replace') {
    try {
      localStorage.setItem('jamie.settings.v1', JSON.stringify(obj.settings));
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return true;
}

export async function clearAllData() {
  const db = await getDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('jamie:data-changed'));
  return true;
}

// ---------- uuid (no runtime dep) ----------

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
