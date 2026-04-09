/*
 * <jamie-settings> — Settings view (v1 + Session C additions)
 *
 * Theme, units, phase, reminders, wake-lock, backup, diagnostics,
 * reset all data, about.
 */

import { DEFAULT_SETTINGS, loadSettings, saveSettings, updateSettings } from '../lib/settings.js';
import { clearAllData } from '../lib/db.js';
import { getContentMeta, getAllEvidence } from '../lib/content.js';

class JamieSettings extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const s = loadSettings();
    const meta = getContentMeta();
    const evidenceCount = getAllEvidence().length;
    this.innerHTML = `
      <section class="view" aria-labelledby="settings-title">
        <div class="section-head">
          <h2 id="settings-title">Settings</h2>
          <span class="muted">Phase, units, reminders, data</span>
        </div>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Appearance</h3></div>
          <div class="field">
            <label class="label" for="set-theme">Theme</label>
            <select id="set-theme" class="input">
              <option value="system" ${s.theme === 'system' ? 'selected' : ''}>System</option>
              <option value="light"  ${s.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark"   ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
            </select>
          </div>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Units</h3></div>
          <div class="field">
            <label class="label" for="set-weight-unit">Weight</label>
            <select id="set-weight-unit" class="input">
              <option value="lb" ${s.display_units.weight === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
              <option value="kg" ${s.display_units.weight === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="set-length-unit">Length</label>
            <select id="set-length-unit" class="input">
              <option value="in" ${s.display_units.length === 'in' ? 'selected' : ''}>Inches (in)</option>
              <option value="cm" ${s.display_units.length === 'cm' ? 'selected' : ''}>Centimetres (cm)</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="set-distance-unit">Distance</label>
            <select id="set-distance-unit" class="input">
              <option value="mi" ${s.display_units.distance === 'mi' ? 'selected' : ''}>Miles (mi)</option>
              <option value="km" ${s.display_units.distance === 'km' ? 'selected' : ''}>Kilometres (km)</option>
            </select>
          </div>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Phase</h3></div>
          <div class="field">
            <label class="label" for="set-phase">Current phase</label>
            <select id="set-phase" class="input">
              <option value="0" ${s.phase === 0 ? 'selected' : ''}>Phase 0 — Maintenance</option>
              <option value="1" ${s.phase === 1 ? 'selected' : ''}>Phase 1 — Lean bulk</option>
            </select>
          </div>
          <p class="muted">Started ${s.phase_start_date || '—'}</p>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Reminders</h3></div>
          <p class="muted">Best-effort PWA notifications. Only fire while the app is running.</p>
          ${reminderRow('morning_log', 'Morning log', s)}
          ${reminderRow('evening_log', 'Evening log', s)}
          ${reminderRow('training', 'Training', s)}
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Session</h3></div>
          <label class="field" style="display:flex;align-items:center;gap:var(--space-2)">
            <input type="checkbox" id="set-wake" ${s.wake_lock ? 'checked' : ''} />
            <span>Keep screen awake during live training sessions</span>
          </label>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Data</h3></div>
          <div class="stack">
            <button type="button" class="btn btn-hero btn-block" data-action="backup">Backup &amp; restore</button>
            <button type="button" class="btn btn-secondary btn-block" data-action="diagnostics">Copy diagnostics</button>
            <button type="button" class="btn btn-secondary btn-block" data-action="reset-settings">Reset settings</button>
            <button type="button" class="btn btn-danger btn-block" data-action="reset-all">Reset all app data</button>
          </div>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">About</h3></div>
          <p class="muted">App v1 · content ${meta.content_version || '—'} · last updated ${meta.last_updated || '—'} · ${evidenceCount} evidence rows</p>
          <div class="cluster">
            <a class="btn btn-secondary" href="#/guides/phase0">Guides</a>
            <a class="btn btn-secondary" href="#/evidence">Evidence library</a>
          </div>
        </article>
      </section>
    `;

    this.querySelector('#set-theme').addEventListener('change', (e) => {
      updateSettings({ theme: e.target.value });
      import('../lib/theme.js').then((m) => m.initTheme?.());
    });

    const bindUnit = (id, key) => {
      this.querySelector(id).addEventListener('change', (e) => {
        const current = loadSettings();
        updateSettings({ display_units: { ...current.display_units, [key]: e.target.value } });
      });
    };
    bindUnit('#set-weight-unit', 'weight');
    bindUnit('#set-length-unit', 'length');
    bindUnit('#set-distance-unit', 'distance');

    this.querySelector('#set-phase').addEventListener('change', (e) => {
      updateSettings({ phase: Number(e.target.value) });
    });

    this.querySelector('#set-wake').addEventListener('change', (e) => {
      updateSettings({ wake_lock: e.target.checked });
    });

    ['morning_log', 'evening_log', 'training'].forEach((key) => {
      const onEl = this.querySelector(`#rem-${key}-on`);
      const timeEl = this.querySelector(`#rem-${key}-time`);
      onEl?.addEventListener('change', async () => {
        if (onEl.checked && 'Notification' in window && Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch {
            /* ignore */
          }
        }
        const cur = loadSettings();
        updateSettings({ reminders: { ...cur.reminders, [`${key}_on`]: onEl.checked } });
      });
      timeEl?.addEventListener('change', () => {
        const cur = loadSettings();
        updateSettings({ reminders: { ...cur.reminders, [key]: timeEl.value || null } });
      });
    });

    this.querySelector('[data-action="backup"]').addEventListener('click', () => {
      window.location.hash = '#/backup';
    });

    this.querySelector('[data-action="diagnostics"]').addEventListener('click', async () => {
      const s2 = loadSettings();
      const safe = { ...s2 };
      const diag = {
        app: 'jamie-pwa v1',
        content_version: meta.content_version,
        schema_version: s2.schema_version,
        settings: safe,
        logs: (window.__jamieLogs || []).slice(-50),
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
        alert('Diagnostics copied to clipboard.');
      } catch {
        alert('Clipboard unavailable.');
      }
    });

    this.querySelector('[data-action="reset-settings"]').addEventListener('click', () => {
      if (confirm('Reset preferences? Logs will be kept.')) {
        saveSettings({ ...DEFAULT_SETTINGS, onboarded: true });
        this.render();
      }
    });

    this.querySelector('[data-action="reset-all"]').addEventListener('click', async () => {
      if (
        !confirm('Reset ALL app data? Logs, sessions, reviews — everything. This cannot be undone.')
      )
        return;
      if (!confirm('Are you absolutely sure? This deletes every log.')) return;
      await clearAllData();
      saveSettings({ ...DEFAULT_SETTINGS });
      window.location.hash = '#/onboarding';
      window.location.reload();
    });
  }
}

function reminderRow(key, label, s) {
  const on = s.reminders[`${key}_on`];
  const time = s.reminders[key] || '';
  return `
    <div class="field" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
      <label style="flex:1;display:flex;align-items:center;gap:var(--space-2);min-height:44px">
        <input type="checkbox" id="rem-${key}-on" ${on ? 'checked' : ''} />
        <span>${label}</span>
      </label>
      <input type="time" id="rem-${key}-time" class="input" value="${time}" style="max-width:120px" />
    </div>
  `;
}

customElements.define('jamie-settings', JamieSettings);
