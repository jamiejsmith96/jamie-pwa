/*
 * <jamie-train> — Train tab landing
 *
 * UX spec §6.2 and wireframe 8.4. Segmented control [Lift | Cardio |
 * Mobility]. Lift subview shows phase + week label, a 7-day strip with
 * session completion ticks, today's session card with "Start session",
 * upcoming list, and a history link.
 */

import { getPhase, getSessionForToday, getSessionsForPhase } from '../lib/content.js';
import { fmtDisplay, parseYMD, todayISO } from '../lib/dates.js';
import { getSessionsThisWeek } from '../lib/db.js';
import { loadSettings } from '../lib/settings.js';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

class JamieTrain extends HTMLElement {
  connectedCallback() {
    this._sub = this._readSub();
    this.render();
    this._onHash = () => {
      const next = this._readSub();
      if (next !== this._sub) {
        this._sub = next;
        this.render();
      }
    };
    window.addEventListener('hashchange', this._onHash);
    window.addEventListener('jamie:data-changed', this._onHash);
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this._onHash);
    window.removeEventListener('jamie:data-changed', this._onHash);
    this.removeEventListener('click', this._onClick);
  }

  _readSub() {
    const h = (window.location.hash || '').replace(/^#/, '');
    if (h.startsWith('/train/cardio')) return 'cardio';
    if (h.startsWith('/train/mobility')) return 'mobility';
    return 'lift';
  }

  _onClick = (e) => {
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      const sub = seg.getAttribute('data-seg');
      if (sub === 'lift') window.location.hash = '#/train';
      else window.location.hash = `#/train/${sub}`;
    }
  };

  async render() {
    const settings = loadSettings();
    const phase = getPhase(settings.phase) || { name: `Phase ${settings.phase}` };
    const week = this._computeWeek(settings.phase_start_date);
    const segBar = `
      <div class="segmented" role="tablist" aria-label="Training mode">
        <button type="button" role="tab" class="seg-btn${this._sub === 'lift' ? ' active' : ''}" data-seg="lift">Lift</button>
        <button type="button" role="tab" class="seg-btn${this._sub === 'cardio' ? ' active' : ''}" data-seg="cardio">Cardio</button>
        <button type="button" role="tab" class="seg-btn${this._sub === 'mobility' ? ' active' : ''}" data-seg="mobility">Mobility</button>
      </div>
    `;

    const subHead = (title, sub) => `
      <div class="section-head">
        <h2>${title}</h2>
        <span class="muted">${sub}</span>
      </div>
    `;

    if (this._sub === 'cardio') {
      this.innerHTML = `<section class="view">${segBar}${subHead('Cardio', phase.name)}<jamie-train-cardio></jamie-train-cardio></section>`;
      await import('./train-cardio.js');
      return;
    }
    if (this._sub === 'mobility') {
      this.innerHTML = `<section class="view">${segBar}${subHead('Mobility', phase.name)}<jamie-train-mobility></jamie-train-mobility></section>`;
      await import('./train-mobility.js');
      return;
    }

    // Lift subview
    const todayDate = new Date();
    const dow = todayDate.getDay();
    const session = getSessionForToday(settings.phase, dow);
    const weekSessions = await getSessionsThisWeek(todayDate);
    const doneByDate = new Set(weekSessions.map((s) => s.date));
    const upcoming = this._getUpcoming(settings.phase, dow);
    const weekDone = weekSessions.length;

    const strip = this._renderWeekStrip(doneByDate, todayDate);
    const heroTitle = session ? session.id.replace(/_/g, ' ') : 'Rest day';
    const heroSub = `${phase.name}${week ? ` · Week ${week}` : ''}`;

    const todayCard = session
      ? `
        <article class="card" aria-labelledby="train-today">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 id="train-today" style="margin:0">Today's session</h3>
            <span class="badge">${session.exercises.length} ex</span>
          </div>
          <ul class="stack" style="list-style:none;padding:0;margin:0 0 var(--space-4)">
            ${session.exercises
              .map(
                (ex) =>
                  `<li class="row"><span>${ex.exercise_id.replace(/_/g, ' ')}</span><span class="muted">${ex.sets || ''}${ex.sets ? ' × ' : ''}${ex.reps || ''}</span></li>`,
              )
              .join('')}
          </ul>
          <a class="btn btn-hero btn-block" href="#/train/session/today" role="button">Start session →</a>
        </article>
      `
      : `
        <article class="card">
          <div class="row" style="margin-bottom:var(--space-2)">
            <h3 style="margin:0">Rest day</h3>
            <span class="badge">Rest</span>
          </div>
          <p class="muted" style="margin:0">No lift scheduled. Consider a mobility block or a Z2 walk.</p>
        </article>
      `;

    const upcomingHtml = upcoming.length
      ? `
        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 style="margin:0">Upcoming</h3>
          </div>
          <ul class="stack" style="list-style:none;padding:0;margin:0">
            ${upcoming
              .map(
                (u) =>
                  `<li class="row"><span>${u.label}</span><span class="muted">${u.session.id.replace(/_/g, ' ')}</span></li>`,
              )
              .join('')}
          </ul>
        </article>
      `
      : '';

    this.innerHTML = `
      <section class="view" aria-labelledby="train-title">
        <header class="hero">
          <p class="hero-eyebrow">Train${week ? ` · Week ${week}` : ''}</p>
          <h1 id="train-title" class="hero-title">${heroTitle}</h1>
          <p class="hero-sub">${heroSub}</p>
        </header>

        <div class="kpi-grid">
          <div class="kpi-tile">
            <span class="kpi-label">This week</span>
            <span class="kpi">${weekDone}<span class="kpi-unit">/3</span></span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Phase</span>
            <span class="kpi">${settings.phase}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Upcoming</span>
            <span class="kpi">${upcoming.length}</span>
          </div>
        </div>

        ${segBar}

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 style="margin:0">This week</h3>
          </div>
          ${strip}
        </article>

        ${todayCard}
        ${upcomingHtml}

        <div class="section-head">
          <h2>More</h2>
        </div>
        <div class="cluster">
          <a class="btn btn-ghost" href="#/log">Session history</a>
          <a class="btn btn-ghost" href="#/train/library">Exercise library</a>
        </div>
      </section>
    `;
  }

  _computeWeek(startIso) {
    if (!startIso) return null;
    const start = parseYMD(startIso);
    if (!start) return null;
    const diff = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diff / 7) + 1);
  }

  _renderWeekStrip(doneByDate, ref) {
    const day = ref.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(ref);
    monday.setDate(ref.getDate() + mondayOffset);
    const today = todayISO();
    let html = '<div class="week-strip" aria-label="This week">';
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const done = doneByDate.has(iso);
      const isToday = iso === today;
      html += `
        <div class="week-day${isToday ? ' today' : ''}${done ? ' done' : ''}" title="${fmtDisplay(iso)}">
          <span class="wd-label">${DAY_LABELS[i]}</span>
          <span class="wd-num">${d.getDate()}</span>
          <span class="wd-dot" aria-hidden="true">${done ? '✓' : ''}</span>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  _getUpcoming(phase, dow) {
    const sessions = getSessionsForPhase(phase);
    const out = [];
    for (let i = 1; i <= 6 && out.length < 3; i++) {
      const nextDow = (dow + i) % 7;
      const dayName = DAY_NAMES[nextDow === 0 ? 6 : nextDow - 1];
      const s = sessions.find((x) => x.day === dayName);
      if (s) {
        out.push({ label: `In ${i} day${i === 1 ? '' : 's'}`, session: s });
      }
    }
    return out;
  }
}

customElements.define('jamie-train', JamieTrain);
