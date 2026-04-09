/*
 * <jamie-today> — landing view
 *
 * UX spec §6.1 / §8.1: three cards (training, daily log status, 7-day).
 * Session 1 stubs the training card to "Coming in Session 2"; the daily
 * log card reads the current daily_log row and shows filled fields.
 */

import { getSessionForToday } from '../lib/content.js';
import { fmtDisplay, greetingFor, todayISO } from '../lib/dates.js';
import { getDailyLog, getSessionsThisWeek } from '../lib/db.js';
import { loadSettings } from '../lib/settings.js';

const LB_PER_KG = 2.2046226218;

class JamieToday extends HTMLElement {
  connectedCallback() {
    this.render();
    this._onSettings = () => this.render();
    window.addEventListener('jamie:settings-changed', this._onSettings);
    window.addEventListener('jamie:data-changed', this._onSettings);
  }

  disconnectedCallback() {
    window.removeEventListener('jamie:settings-changed', this._onSettings);
    window.removeEventListener('jamie:data-changed', this._onSettings);
  }

  async render() {
    const settings = loadSettings();
    const today = todayISO();
    const log = await getDailyLog(today);
    const unit = settings.display_units?.weight || 'lb';
    let todaySession = null;
    let weekSessions = 0;
    try {
      todaySession = getSessionForToday(settings.phase, new Date().getDay());
      const week = await getSessionsThisWeek();
      weekSessions = week?.length || 0;
    } catch {}

    const weightDisplay = log?.weight_kg
      ? unit === 'lb'
        ? `${(log.weight_kg * LB_PER_KG).toFixed(1)} lb`
        : `${log.weight_kg.toFixed(1)} kg`
      : '—';

    const sleepDisplay = Number.isFinite(log?.sleep_h) ? `${log.sleep_h} h` : '—';
    const morningDone = Boolean(log?.weight_kg && Number.isFinite(log?.sleep_h));
    const eveningDone = Boolean(
      log?.notes != null ||
        Number.isFinite(log?.alcohol_units) ||
        Number.isFinite(log?.recovery_1_10),
    );

    const [weightVal, weightUnit] = weightDisplay === '—'
      ? ['—', '']
      : weightDisplay.split(' ');
    const [sleepVal, sleepUnit] = sleepDisplay === '—' ? ['—', ''] : sleepDisplay.split(' ');

    this.innerHTML = `
      <section class="view" aria-labelledby="today-title">
        <header class="hero">
          <p class="hero-eyebrow">${greetingFor()} · ${fmtDisplay(today)}</p>
          <h1 id="today-title" class="hero-title">${todaySession ? (todaySession.name || todaySession.id) : 'Rest day'}</h1>
          <p class="hero-sub">Phase ${settings.phase}${settings.phase_start_date ? ` · started ${fmtDisplay(settings.phase_start_date)}` : ''}</p>
        </header>

        <div class="kpi-grid">
          <div class="kpi-tile">
            <span class="kpi-label">Weight</span>
            <span class="kpi">${weightVal}${weightUnit ? `<span class="kpi-unit">${weightUnit}</span>` : ''}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Sleep</span>
            <span class="kpi">${sleepVal}${sleepUnit ? `<span class="kpi-unit">${sleepUnit}</span>` : ''}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Week</span>
            <span class="kpi">${weekSessions}<span class="kpi-unit">/3</span></span>
          </div>
        </div>

        <article class="card" aria-labelledby="today-training">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="today-training" style="margin:0">Today's training</h3>
            ${todaySession ? '<span class="badge">Scheduled</span>' : '<span class="badge">Rest</span>'}
          </div>
          <p class="muted" style="margin:0 0 var(--space-4)">
            ${todaySession ? `Session ${todaySession.id}` : 'Take it easy — walk, stretch, hydrate.'}
          </p>
          <a class="btn btn-hero btn-block" href="#/train" role="button">${todaySession ? 'Start session →' : 'Open Train'}</a>
        </article>

        <article class="card" aria-labelledby="today-log">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="today-log" style="margin:0">Daily log</h3>
            <span class="cluster">
              <span class="badge ${morningDone ? 'tier-t1' : ''}">AM ${morningDone ? 'Done' : 'Pending'}</span>
              <span class="badge ${eveningDone ? 'tier-t1' : ''}">PM ${eveningDone ? 'Done' : 'Pending'}</span>
            </span>
          </div>
          <a class="btn btn-secondary btn-block" href="#/log" role="button">Open log</a>
        </article>

        <article class="card" aria-labelledby="today-stats">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="today-stats" style="margin:0">7-day trend</h3>
            <a class="section-link" href="#/stats">Details →</a>
          </div>
          <p class="muted" style="margin:0 0 var(--space-3)">
            ${weekSessions} session${weekSessions === 1 ? '' : 's'} logged this week
          </p>
        </article>
      </section>
    `;
  }
}

customElements.define('jamie-today', JamieToday);
