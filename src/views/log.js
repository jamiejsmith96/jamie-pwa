/*
 * <jamie-log> — daily log view
 *
 * UX spec §6.8 / §8.3. Field-level save on blur (no submit button).
 * Writes to daily_log keyed by todayISO(). Display layer converts weight
 * between stored kg and user-preferred unit.
 *
 * Fields covered in v1 Session 1 (from v1 spec §5.5):
 *   weight, sleep_h, cigarettes, recovery_1_10,
 *   last_caffeine_time, alcohol_units, notes
 * plus steps (from ux spec §6.8).
 */

import { fmtDisplay, todayISO } from '../lib/dates.js';
import { getDailyLog, putDailyLog } from '../lib/db.js';
import { haptics } from '../lib/haptics.js';
import { loadSettings } from '../lib/settings.js';

const LB_PER_KG = 2.2046226218;

class JamieLog extends HTMLElement {
  constructor() {
    super();
    this._row = null;
  }

  async connectedCallback() {
    this._row = (await getDailyLog(todayISO())) || { date: todayISO() };
    this.render();
  }

  render() {
    const settings = loadSettings();
    const unit = settings.display_units?.weight || 'lb';
    const row = this._row || {};

    const weightDisplayValue =
      row.weight_kg != null
        ? unit === 'lb'
          ? (row.weight_kg * LB_PER_KG).toFixed(1)
          : row.weight_kg.toFixed(1)
        : '';

    const weightKpi = row.weight_kg != null
      ? (unit === 'lb' ? (row.weight_kg * LB_PER_KG).toFixed(1) : row.weight_kg.toFixed(1))
      : '—';
    const sleepKpi = Number.isFinite(row.sleep_h) ? String(row.sleep_h) : '—';
    const recoveryKpi = Number.isFinite(row.recovery_1_10) ? String(row.recovery_1_10) : '—';

    this.innerHTML = `
      <section class="view" aria-labelledby="log-title">
        <div class="section-head">
          <h2 id="log-title">Daily log</h2>
          <span class="muted">${fmtDisplay(todayISO())}</span>
        </div>

        <div class="kpi-grid">
          <div class="kpi-tile">
            <span class="kpi-label">Weight</span>
            <span class="kpi">${weightKpi}${weightKpi !== '—' ? `<span class="kpi-unit">${unit}</span>` : ''}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Sleep</span>
            <span class="kpi">${sleepKpi}${sleepKpi !== '—' ? '<span class="kpi-unit">h</span>' : ''}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Recovery</span>
            <span class="kpi">${recoveryKpi}${recoveryKpi !== '—' ? '<span class="kpi-unit">/10</span>' : ''}</span>
          </div>
        </div>

        <article class="card" aria-labelledby="log-morning">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="log-morning" style="margin:0">Morning</h3>
          </div>

          <div class="field">
            <label class="label" for="log-weight">Weight (${unit})</label>
            <input id="log-weight" class="input" type="number" inputmode="decimal" step="0.1"
              min="20" max="400" value="${weightDisplayValue}" />
            <span class="saved" data-saved="weight" hidden>saved</span>
          </div>

          <div class="field">
            <label class="label" for="log-sleep">Sleep (hours)</label>
            <input id="log-sleep" class="input" type="number" inputmode="decimal" step="0.5"
              min="0" max="24" value="${row.sleep_h ?? ''}" />
            <span class="saved" data-saved="sleep_h" hidden>saved</span>
          </div>

          <div class="field">
            <label class="label" for="log-recovery">Recovery (1–10)</label>
            <input id="log-recovery" class="input" type="number" inputmode="numeric" step="1"
              min="1" max="10" value="${row.recovery_1_10 ?? ''}" />
            <span class="saved" data-saved="recovery_1_10" hidden>saved</span>
          </div>
        </article>

        <article class="card" aria-labelledby="log-daytime">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="log-daytime" style="margin:0">Daytime</h3>
          </div>

          <div class="field">
            <label class="label" for="log-steps">Steps</label>
            <input id="log-steps" class="input" type="number" inputmode="numeric" step="100"
              min="0" max="100000" value="${row.steps ?? ''}" />
            <span class="saved" data-saved="steps" hidden>saved</span>
          </div>

          <div class="field">
            <label class="label" for="log-cigs">Cigarettes yesterday</label>
            <input id="log-cigs" class="input" type="number" inputmode="numeric" step="1"
              min="0" max="200" value="${row.cigarettes ?? ''}" />
            <span class="saved" data-saved="cigarettes" hidden>saved</span>
          </div>

          <div class="field">
            <label class="label" for="log-caffeine">Last caffeine (24h)</label>
            <input id="log-caffeine" class="input" type="time" value="${row.last_caffeine_time ?? ''}" />
            <span class="saved" data-saved="last_caffeine_time" hidden>saved</span>
          </div>
        </article>

        <article class="card" aria-labelledby="log-evening">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="log-evening" style="margin:0">Evening</h3>
          </div>

          <div class="field">
            <label class="label" for="log-alcohol">Alcohol units</label>
            <input id="log-alcohol" class="input" type="number" inputmode="decimal" step="0.5"
              min="0" max="50" value="${row.alcohol_units ?? ''}" />
            <span class="saved" data-saved="alcohol_units" hidden>saved</span>
          </div>

          <div class="field">
            <label class="label" for="log-notes">Notes</label>
            <input id="log-notes" class="input" type="text" value="${row.notes ? escapeHtml(row.notes) : ''}" />
            <span class="saved" data-saved="notes" hidden>saved</span>
          </div>
        </article>
      </section>
    `;

    this.bind(
      '#log-weight',
      'weight_kg',
      (v) => {
        const n = Number.parseFloat(v);
        if (!Number.isFinite(n)) return undefined;
        return unit === 'lb' ? Number((n / LB_PER_KG).toFixed(2)) : Number(n.toFixed(2));
      },
      'weight',
    );

    this.bind('#log-sleep', 'sleep_h', (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    });
    this.bind('#log-recovery', 'recovery_1_10', (v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    });
    this.bind('#log-steps', 'steps', (v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    });
    this.bind('#log-cigs', 'cigarettes', (v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    });
    this.bind('#log-caffeine', 'last_caffeine_time', (v) => (v ? String(v) : undefined));
    this.bind('#log-alcohol', 'alcohol_units', (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    });
    this.bind('#log-notes', 'notes', (v) => (v ? String(v) : undefined));
  }

  bind(selector, field, parse, savedKey = field) {
    const el = this.querySelector(selector);
    if (!el) return;
    const savedEl = this.querySelector(`[data-saved="${savedKey}"]`);
    const commit = async () => {
      const parsed = parse(el.value);
      if (parsed === undefined) return;
      this._row = { ...this._row, date: todayISO(), [field]: parsed };
      await putDailyLog({ date: todayISO(), [field]: parsed });
      haptics.save();
      if (savedEl) {
        savedEl.hidden = false;
        clearTimeout(savedEl._t);
        savedEl._t = setTimeout(() => {
          savedEl.hidden = true;
        }, 1500);
      }
      window.dispatchEvent(new CustomEvent('jamie:data-changed'));
    };
    el.addEventListener('blur', commit);
    el.addEventListener('change', commit);
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );
}

customElements.define('jamie-log', JamieLog);
