/*
 * Jamie PWA — settings (LocalStorage)
 *
 * Settings shape from v1 spec section 6 plus v1 additions for theme
 * and display units. Single JSON blob under one key so reads/writes
 * are atomic at the app level.
 *
 * Units policy (from stack doc section 15): storage is SI, the
 * display layer converts. Default display = lb / in / mi for Jamie.
 */

const KEY = 'jamie.settings.v1';

export const DEFAULT_SETTINGS = {
  schema_version: 1,
  onboarded: false,
  phase: 0,
  phase_start_date: null, // ISO date
  cardio_kit: null,
  bodyweight_kg: null,
  protein_target_g: 120,
  kcal_target: null,
  vit_d_dose_iu: null,
  last_content_version: null,

  // display preferences
  theme: 'system', // 'light' | 'dark' | 'system'
  display_units: {
    weight: 'lb', // 'lb' | 'kg'
    length: 'in', // 'in' | 'cm'
    distance: 'mi', // 'mi' | 'km'
  },
  reminders: {
    morning_log: null, // 'HH:MM' or null
    evening_log: null,
    training: null,
    morning_log_on: false,
    evening_log_on: false,
    training_on: false,
  },
  wake_lock: true,
  last_backup_at: null, // ISO datetime
  recipe_filters: {}, // persisted recipe filter state
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    // shallow-merge to pick up any new default keys added in later versions
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      display_units: { ...DEFAULT_SETTINGS.display_units, ...(parsed.display_units || {}) },
      reminders: { ...DEFAULT_SETTINGS.reminders, ...(parsed.reminders || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent('jamie:settings-changed', { detail: settings }));
  return settings;
}

export function updateSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  return saveSettings(next);
}
