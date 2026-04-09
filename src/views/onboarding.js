/*
 * <jamie-onboarding> — first-run flow
 *
 * UX spec journey J1: 3 screens, skippable-ish.
 *   1. Welcome ("data stays on this phone")
 *   2. Pick phase (default Phase 0)
 *   3. Quick baseline (weight, writes initial daily_log row)
 *
 * On finish:
 *   - settings.onboarded = true
 *   - settings.phase_start_date = today (ISO)
 *   - daily_log row for today with weight_kg
 *   - navigator.storage.persist() requested
 *   - navigates to #/today
 */

import { todayISO } from '../lib/dates.js';
import { putDailyLog, requestPersistentStorage } from '../lib/db.js';
import { haptics } from '../lib/haptics.js';
import { loadSettings, updateSettings } from '../lib/settings.js';

const LB_PER_KG = 2.2046226218;

class JamieOnboarding extends HTMLElement {
  constructor() {
    super();
    this.step = 0;
    this.data = { phase: 0, weight: '' };
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const settings = loadSettings();
    const unit = settings.display_units?.weight || 'lb';
    const steps = [
      {
        eyebrow: 'Welcome',
        title: 'Yours, locally',
        sub: 'Everything you log stays on this phone.',
        body: `
          <p class="muted">No account, no cloud, no tracking. Back up weekly from Settings.</p>
        `,
        primary: 'Continue',
      },
      {
        eyebrow: 'Setup',
        title: 'Pick your phase',
        sub: 'You can change this later in Settings.',
        body: `
          <div class="field">
            <label class="label">Current phase</label>
            <div class="segmented" id="ob-phase-seg">
              <button type="button" class="seg-btn ${this.data.phase === 0 ? 'active' : ''}" data-phase="0">Phase 0 — Maintain</button>
              <button type="button" class="seg-btn ${this.data.phase === 1 ? 'active' : ''}" data-phase="1">Phase 1 — Lean bulk</button>
            </div>
          </div>
        `,
        primary: 'Continue',
      },
      {
        eyebrow: 'Baseline',
        title: 'Starting weight',
        sub: `Stored internally in kg. Displayed in ${unit}.`,
        body: `
          <div class="field">
            <label class="label" for="ob-weight">Bodyweight (${unit})</label>
            <input
              id="ob-weight"
              class="input"
              type="number"
              inputmode="decimal"
              step="0.1"
              min="20"
              max="400"
              value="${this.data.weight}"
              placeholder="e.g. ${unit === 'lb' ? '165' : '75'}"
            />
          </div>
        `,
        primary: 'Finish',
      },
    ];

    const step = steps[this.step];
    const dotHTML = steps
      .map(
        (_, i) =>
          `<span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px;background:${
            i === this.step ? 'var(--accent)' : 'var(--bg-3)'
          }"></span>`,
      )
      .join('');

    this.innerHTML = `
      <section class="view" aria-labelledby="ob-title">
        <header class="hero">
          <p class="hero-eyebrow">${step.eyebrow}</p>
          <h1 id="ob-title" class="hero-title">${step.title}</h1>
          <p class="hero-sub">${step.sub}</p>
        </header>
        <div style="text-align:center;margin-bottom:var(--space-4)">${dotHTML}</div>
        <article class="card">
          ${step.body}
        </article>
        <div class="stack">
          <button type="button" class="btn btn-hero btn-block" data-action="next">${step.primary}</button>
          ${
            this.step > 0
              ? '<button type="button" class="btn btn-secondary btn-block" data-action="back">Back</button>'
              : ''
          }
        </div>
      </section>
    `;

    this.querySelector('[data-action="next"]').addEventListener('click', () => this.next());
    this.querySelector('[data-action="back"]')?.addEventListener('click', () => this.back());

    if (this.step === 1) {
      this.querySelectorAll('#ob-phase-seg [data-phase]').forEach((b) => {
        b.addEventListener('click', () => {
          this.data.phase = Number(b.dataset.phase);
          this.render();
        });
      });
    }
    if (this.step === 2) {
      const el = this.querySelector('#ob-weight');
      el.addEventListener('input', (e) => {
        this.data.weight = e.target.value;
      });
      setTimeout(() => el.focus(), 0);
    }
  }

  back() {
    if (this.step > 0) {
      this.step--;
      this.render();
    }
  }

  async next() {
    haptics.tap();
    if (this.step < 2) {
      this.step++;
      this.render();
      return;
    }
    // finish
    const settings = loadSettings();
    const unit = settings.display_units?.weight || 'lb';
    const raw = Number.parseFloat(this.data.weight);
    if (!Number.isFinite(raw) || raw <= 0) {
      this.querySelector('#ob-weight')?.focus();
      return;
    }
    const weight_kg = unit === 'lb' ? raw / LB_PER_KG : raw;
    const today = todayISO();

    await putDailyLog({ date: today, weight_kg: Number(weight_kg.toFixed(2)) });
    updateSettings({
      onboarded: true,
      phase: this.data.phase,
      phase_start_date: today,
      bodyweight_kg: Number(weight_kg.toFixed(2)),
    });
    await requestPersistentStorage();
    haptics.save();
    window.location.hash = '#/today';
  }
}

customElements.define('jamie-onboarding', JamieOnboarding);
