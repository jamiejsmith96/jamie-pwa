/*
 * <jamie-stats> — Stats view (v1 spec §5.6 + §5.7, UX §6.13 + §6.14)
 *
 * Tabs: Overview | Training | Body | Review.
 * Chart.js is imported lazily so the main bundle stays light.
 * Review sub-tab applies decision rules from content.decision_rules.
 */

import { getAllExercises, getDecisionRules } from '../lib/content.js';
import { fmtDisplay, todayISO } from '../lib/dates.js';
import {
  addReview,
  getAllCardioLogs,
  getAllDailyLogs,
  getAllSessionLogs,
  getAllTrainingLogs,
  getLatestReview,
} from '../lib/db.js';
import { loadSettings } from '../lib/settings.js';

let ChartMod = null;
async function getChart() {
  if (ChartMod) return ChartMod;
  const m = await import('chart.js/auto');
  ChartMod = m.default || m.Chart || m;
  return ChartMod;
}

function kgToDisplay(kg, unit) {
  if (kg == null) return null;
  return unit === 'lb' ? kg * 2.2046226 : kg;
}

function ema(values, span) {
  const k = 2 / (span + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) {
      out.push(prev);
      continue;
    }
    if (prev == null) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

function cssVar(name, fallback) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

class JamieStats extends HTMLElement {
  constructor() {
    super();
    this._tab = 'overview';
    this._charts = [];
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.destroyCharts();
  }

  destroyCharts() {
    for (const c of this._charts) {
      try {
        c.destroy();
      } catch {
        /* ignore */
      }
    }
    this._charts = [];
  }

  render() {
    this.destroyCharts();
    const titles = {
      overview: 'Last 7 days',
      training: 'Training',
      body: 'Body',
      review: 'Sunday review',
    };
    this.innerHTML = `
      <section class="view">
        <div class="section-head">
          <h2>${titles[this._tab]}</h2>
          <span class="muted">Trends across your logged data</span>
        </div>
        <div class="segmented" role="tablist">
          ${['overview', 'training', 'body', 'review']
            .map(
              (t) =>
                `<button type="button" class="seg-btn ${t === this._tab ? 'active' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`,
            )
            .join('')}
        </div>
        <div id="stats-body"><p class="muted">Loading…</p></div>
      </section>
    `;
    this.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this._tab = b.dataset.tab;
        this.render();
      });
    });
    if (this._tab === 'overview') this.renderOverview();
    else if (this._tab === 'training') this.renderTraining();
    else if (this._tab === 'body') this.renderBody();
    else this.renderReview();
  }

  async renderOverview() {
    const body = this.querySelector('#stats-body');
    const [daily, sessions] = await Promise.all([getAllDailyLogs(), getAllSessionLogs()]);
    const s = loadSettings();
    const unit = s.display_units.weight;

    // 7d window
    const today = new Date();
    const in7 = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      in7.add(toISO(d));
    }
    const sessions7 = sessions.filter((r) => in7.has(r.date));
    const sleep7 = daily.filter((r) => in7.has(r.date) && r.sleep_h != null);
    const sleepAvg = sleep7.length
      ? sleep7.reduce((a, r) => a + r.sleep_h, 0) / sleep7.length
      : null;

    // 28 day weight sorted
    const w28 = [...daily]
      .filter((r) => r.weight_kg != null)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-28);
    const weights = w28.map((r) => kgToDisplay(r.weight_kg, unit));
    const wEma = ema(weights, 14);
    const emaDelta = wEma.length >= 2 ? (wEma[wEma.length - 1] - wEma[0]).toFixed(1) : '—';

    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-tile">
          <span class="kpi-label">Sessions</span>
          <span class="kpi">${sessions7.length}<span class="kpi-unit">/3</span></span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Avg sleep</span>
          <span class="kpi">${sleepAvg != null ? sleepAvg.toFixed(1) : '—'}${sleepAvg != null ? '<span class="kpi-unit">h</span>' : ''}</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Weight Δ</span>
          <span class="kpi">${emaDelta}${emaDelta !== '—' ? `<span class="kpi-unit">${unit}</span>` : ''}</span>
        </div>
      </div>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)">
          <h3 style="margin:0">Weight 28d (${unit})</h3>
          <span class="badge">EMA 14d</span>
        </div>
        <canvas id="weight-28" height="160"></canvas>
      </article>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)">
          <h3 style="margin:0">Sessions</h3>
          <span class="badge">Last 8 wks</span>
        </div>
        <canvas id="sess-8" height="160"></canvas>
      </article>
    `;

    const Chart = await getChart();
    const fg = cssVar('--fg-0', '#111');
    const accent = cssVar('--accent', '#0a6');

    if (weights.length) {
      this._charts.push(
        new Chart(body.querySelector('#weight-28'), {
          type: 'line',
          data: {
            labels: w28.map((r) => r.date.slice(5)),
            datasets: [
              { label: 'Weight', data: weights, borderColor: fg, pointRadius: 2, tension: 0.2 },
              { label: 'EMA 14d', data: wEma, borderColor: accent, pointRadius: 0, tension: 0.3 },
            ],
          },
          options: { responsive: true, plugins: { legend: { display: true } } },
        }),
      );
    }

    // 8-wk sessions
    const buckets = Array(8).fill(0);
    const labels = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * 7);
      labels.push(`W-${i}`);
    }
    sessions.forEach((r) => {
      const dt = new Date(r.date);
      const wksAgo = Math.floor((today - dt) / (7 * 86400000));
      if (wksAgo >= 0 && wksAgo < 8) buckets[7 - wksAgo]++;
    });
    this._charts.push(
      new Chart(body.querySelector('#sess-8'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Sessions', data: buckets, backgroundColor: accent }] },
        options: { responsive: true },
      }),
    );
  }

  async renderTraining() {
    const body = this.querySelector('#stats-body');
    const [tlogs, exercises] = await Promise.all([getAllTrainingLogs(), getAllExercises()]);
    const byEx = new Map();
    tlogs.forEach((r) => {
      if (!r.exercise_id) return;
      if (!byEx.has(r.exercise_id)) byEx.set(r.exercise_id, []);
      byEx.get(r.exercise_id).push(r);
    });
    const exIds = [...byEx.keys()];
    body.innerHTML = `
      <div class="field">
        <label class="label" for="ex-pick">Exercise</label>
        <select id="ex-pick" class="input">
          ${
            exIds
              .map(
                (id) =>
                  `<option value="${id}">${exercises.find((e) => e.id === id)?.name || id}</option>`,
              )
              .join('') || '<option>No training logged yet</option>'
          }
        </select>
      </div>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Estimated 1RM</h3><span class="badge">Epley</span></div>
        <canvas id="e1rm" height="160"></canvas>
      </article>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Weekly volume</h3><span class="badge">kg·reps</span></div>
        <canvas id="vol" height="160"></canvas>
      </article>
    `;

    if (!exIds.length) return;
    const Chart = await getChart();
    const accent = cssVar('--accent', '#0a6');
    const fg = cssVar('--fg-0', '#111');

    const draw = (exId) => {
      this.destroyCharts();
      const rows = (byEx.get(exId) || []).sort((a, b) =>
        (a.datetime || '') < (b.datetime || '') ? -1 : 1,
      );
      const e1rm = rows.map((r) => epley(r.weight_kg || 0, r.reps || 0));
      const labels = rows.map((r) => (r.datetime || '').slice(5, 10));
      this._charts.push(
        new Chart(body.querySelector('#e1rm'), {
          type: 'line',
          data: {
            labels,
            datasets: [{ label: 'e1RM', data: e1rm, borderColor: fg, tension: 0.2 }],
          },
          options: { responsive: true },
        }),
      );
      // weekly volume
      const today = new Date();
      const vols = Array(8).fill(0);
      const vlabels = [];
      for (let i = 7; i >= 0; i--) vlabels.push(`W-${i}`);
      rows.forEach((r) => {
        const dt = new Date(r.datetime || today);
        const w = Math.floor((today - dt) / (7 * 86400000));
        if (w >= 0 && w < 8) vols[7 - w] += (r.weight_kg || 0) * (r.reps || 0);
      });
      this._charts.push(
        new Chart(body.querySelector('#vol'), {
          type: 'bar',
          data: {
            labels: vlabels,
            datasets: [{ label: 'Volume', data: vols, backgroundColor: accent }],
          },
          options: { responsive: true },
        }),
      );
    };
    draw(exIds[0]);
    body.querySelector('#ex-pick').addEventListener('change', (e) => draw(e.target.value));
  }

  async renderBody() {
    const body = this.querySelector('#stats-body');
    const daily = await getAllDailyLogs();
    const s = loadSettings();
    const unit = s.display_units.weight;
    const w = daily.filter((r) => r.weight_kg != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!w.length) {
      body.innerHTML = `<p class="muted">No weight data yet. Log a weight in the Log tab.</p>`;
      return;
    }
    body.innerHTML = `
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Weight (${unit})</h3><span class="badge">EMA 14d</span></div>
        <canvas id="body-w" height="180"></canvas>
      </article>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Measurements</h3></div>
        <p class="muted" style="margin:0">Waist, chest, neck measurements are not in the v1 schema. Add via a future update.</p>
      </article>
    `;
    const Chart = await getChart();
    const fg = cssVar('--fg-0', '#111');
    const accent = cssVar('--accent', '#0a6');
    const vals = w.map((r) => kgToDisplay(r.weight_kg, unit));
    this._charts.push(
      new Chart(body.querySelector('#body-w'), {
        type: 'line',
        data: {
          labels: w.map((r) => r.date.slice(5)),
          datasets: [
            { label: 'Weight', data: vals, borderColor: fg, pointRadius: 2 },
            { label: 'EMA 14d', data: ema(vals, 14), borderColor: accent, pointRadius: 0 },
          ],
        },
        options: { responsive: true },
      }),
    );
  }

  async renderReview() {
    const body = this.querySelector('#stats-body');
    const [daily, sessions, cardio, latest] = await Promise.all([
      getAllDailyLogs(),
      getAllSessionLogs(),
      getAllCardioLogs(),
      getLatestReview(),
    ]);
    const s = loadSettings();
    const phase = s.phase || 0;
    const unit = s.display_units.weight;
    const today = new Date();
    const in7 = new Set();
    const prev7 = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      in7.add(toISO(d));
      const p = new Date(today);
      p.setDate(today.getDate() - i - 7);
      prev7.add(toISO(p));
    }
    const avg = (arr, key) => {
      const vals = arr.map((r) => r[key]).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const w7 = avg(
      daily.filter((r) => in7.has(r.date)),
      'weight_kg',
    );
    const wPrev = avg(
      daily.filter((r) => prev7.has(r.date)),
      'weight_kg',
    );
    const delta = w7 != null && wPrev != null ? w7 - wPrev : null;
    const sessions7 = sessions.filter((r) => in7.has(r.date)).length;
    const sleep7 = avg(
      daily.filter((r) => in7.has(r.date)),
      'sleep_h',
    );
    const cardio7 = cardio
      .filter((r) => in7.has((r.datetime || '').slice(0, 10)))
      .reduce((a, r) => a + (r.duration_min || 0), 0);

    const ctx = {
      weight_delta_kg: delta,
      weight_delta_2w: delta,
      weight_stable_14d: delta != null && Math.abs(delta) <= 0.3,
      sessions_completed: sessions7,
      sleep_avg: sleep7,
      cardio_min: cardio7,
    };
    const rules = getDecisionRules(phase) || [];
    const matched = rules.filter((r) => evalTrigger(r.trigger, ctx));

    const w7disp = w7 != null ? kgToDisplay(w7, unit).toFixed(1) : '—';
    const deltaDisp =
      delta != null ? (delta >= 0 ? '+' : '') + kgToDisplay(delta, unit).toFixed(2) : '—';

    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-tile">
          <span class="kpi-label">Weight 7d</span>
          <span class="kpi">${w7disp}${w7disp !== '—' ? `<span class="kpi-unit">${unit}</span>` : ''}</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Sessions</span>
          <span class="kpi">${sessions7}<span class="kpi-unit">/3</span></span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Cardio</span>
          <span class="kpi">${Math.round(cardio7)}<span class="kpi-unit">min</span></span>
        </div>
      </div>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Weekly deltas</h3><span class="badge">${fmtDisplay(todayISO())}</span></div>
        <div class="row"><span class="muted">Weight Δ</span><strong>${deltaDisp} ${unit}</strong></div>
        <div class="row"><span class="muted">Sleep avg</span><strong>${sleep7 != null ? sleep7.toFixed(1) + ' h' : '—'}</strong></div>
        <p class="muted" style="margin:var(--space-3) 0 0">Protein-hit days: pending nutrition-log integration.</p>
      </article>
      <article class="card">
        <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Decision rules</h3><span class="badge">Phase ${phase}</span></div>
        ${
          matched.length
            ? `<ul class="stack" style="list-style:none;padding:0;margin:0">${matched.map((r) => `<li><strong>${r.action}</strong> — ${esc(r.message)}</li>`).join('')}</ul>`
            : '<p class="muted" style="margin:0">No rules triggered.</p>'
        }
      </article>
      <button type="button" class="btn btn-hero btn-block" data-act="export">Export review (markdown)</button>
      ${latest ? `<p class="muted" style="text-align:center;margin-top:var(--space-2)">Last saved: ${esc(latest.date)}</p>` : ''}
    `;

    body.querySelector('[data-act="export"]').addEventListener('click', async () => {
      const md = [
        `# Sunday review — ${todayISO()}`,
        '',
        `- Phase: ${phase}`,
        `- Weight 7d avg: ${w7disp} ${unit} (Δ ${deltaDisp})`,
        `- Sessions: ${sessions7} / 3`,
        `- Sleep avg: ${sleep7 != null ? sleep7.toFixed(1) + ' h' : '—'}`,
        `- Cardio: ${Math.round(cardio7)} min`,
        '',
        '## Decisions',
        ...(matched.length
          ? matched.map((r) => `- **${r.action}** — ${r.message}`)
          : ['- No rules triggered.']),
      ].join('\n');
      await addReview({
        date: todayISO(),
        weight_avg_7d: w7,
        weight_delta: delta,
        sessions_completed: sessions7,
        sleep_avg: sleep7,
        cardio_min: cardio7,
        decision: matched.map((r) => r.action).join(', ') || 'none',
        markdown: md,
      });
      try {
        await navigator.clipboard.writeText(md);
      } catch {
        /* ignore */
      }
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: `jamie_review_${todayISO()}.md`,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
          });
          const ws = await handle.createWritable();
          await ws.write(md);
          await ws.close();
        } catch {
          /* user cancelled */
        }
      } else {
        const blob = new Blob([md], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `jamie_review_${todayISO()}.md`;
        a.click();
      }
      this.renderReview();
    });
  }
}

function evalTrigger(trigger, ctx) {
  if (!trigger) return false;
  // safe-ish evaluator: recognise a handful of simple forms
  try {
    // substitute identifiers
    const expr = trigger
      .replace(/weight_delta_2w/g, String(ctx.weight_delta_2w ?? 'null'))
      .replace(/weight_delta_kg/g, String(ctx.weight_delta_kg ?? 'null'))
      .replace(/sessions_completed/g, String(ctx.sessions_completed ?? 0))
      .replace(/sleep_avg/g, String(ctx.sleep_avg ?? 0))
      .replace(/cardio_min/g, String(ctx.cardio_min ?? 0));
    if (trigger === 'weight_stable_14d_within_0.3kg') return ctx.weight_stable_14d;
    // eslint-disable-next-line no-new-func
    return Boolean(Function(`"use strict";return (${expr});`)());
  } catch {
    return false;
  }
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function esc(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

customElements.define('jamie-stats', JamieStats);
