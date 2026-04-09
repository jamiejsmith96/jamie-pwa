/*
 * <jamie-train-session> — live session logger
 *
 * Wireframe 8.2 / journey J2. Fullscreen modal-style view. Tracks sets
 * across exercises in the programmed session, persists in-progress
 * state to localStorage on every change, acquires a wake lock, runs a
 * rest timer between sets with an SVG ring and audio/haptic cues, and
 * writes a session_log row + training_log rows on completion.
 *
 * Units: internal storage always kg. The display weight stepper uses
 * kg directly (stepper increments 1.25 / 2.5 / 5 kg). This keeps data
 * simple; a future polish can toggle to lb display if Jamie prefers.
 */

import { getExercise, getSessionForToday } from '../lib/content.js';
import { nowUTC, todayISO } from '../lib/dates.js';
import {
  clearInProgressSession,
  getLastSetForExercise,
  loadInProgressSession,
  saveCompletedSession,
  saveInProgressSession,
  uuid,
} from '../lib/db.js';
import { haptics } from '../lib/haptics.js';
import { loadSettings } from '../lib/settings.js';

const DEFAULT_REST_S = 120;

function beep(freq = 880, duration = 0.15) {
  try {
    if (!beep._ctx) beep._ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = beep._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch {
    /* audio optional */
  }
}

class JamieTrainSession extends HTMLElement {
  connectedCallback() {
    this._state = this._initState();
    this._wakeLock = null;
    this._acquireWakeLock();
    this._timer = null;
    this._restEndsAt = 0;
    this._restTotal = 0;
    this.render();
    this.addEventListener('click', this._onClick);
    window.addEventListener('beforeunload', this._persist);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    window.removeEventListener('beforeunload', this._persist);
    this._stopTimer();
    this._releaseWakeLock();
  }

  _initState() {
    const settings = loadSettings();
    const resumed = loadInProgressSession();
    const todayDate = new Date();
    const programmed = getSessionForToday(settings.phase, todayDate.getDay());
    if (resumed && resumed.session_content_id === programmed?.id) {
      this._resumedFromDisk = true;
      return resumed;
    }
    if (!programmed) {
      return { empty: true };
    }
    return {
      id: uuid(),
      session_content_id: programmed.id,
      phase: settings.phase,
      date: todayISO(),
      started_at: nowUTC(),
      exercise_index: 0,
      set_index: 0,
      exercises: programmed.exercises.map((e) => ({
        exercise_id: e.exercise_id,
        target_sets: e.sets || 3,
        target_reps: e.reps || '8-12',
        rest_s: e.rest_s || DEFAULT_REST_S,
        unilateral: !!e.unilateral,
        sets: [], // {weight_kg, reps, rpe, datetime}
      })),
      session_rpe: null,
      completed: false,
    };
  }

  _persist = () => {
    if (this._state && !this._state.completed && !this._state.empty) {
      saveInProgressSession(this._state);
    }
  };

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* user may deny; non-fatal */
    }
  }

  _releaseWakeLock() {
    try {
      this._wakeLock?.release?.();
    } catch {
      /* ignore */
    }
    this._wakeLock = null;
  }

  _onClick = (e) => {
    const act = e.target.closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    if (act === 'close') return this._confirmClose();
    if (act === 'weight-') return this._adjustWeight(-1);
    if (act === 'weight+') return this._adjustWeight(1);
    if (act === 'reps-') return this._adjustReps(-1);
    if (act === 'reps+') return this._adjustReps(1);
    if (act === 'done-set') return this._doneSet();
    if (act === 'skip-rest') return this._finishRest();
    if (act === 'add-rest') return this._extendRest(30);
    if (act === 'rpe') {
      const v = Number(e.target.closest('[data-rpe]')?.getAttribute('data-rpe'));
      if (Number.isFinite(v)) this._setRpe(v);
      return;
    }
    if (act === 'session-rpe') {
      const v = Number(e.target.closest('[data-srpe]')?.getAttribute('data-srpe'));
      if (Number.isFinite(v)) this._setSessionRpe(v);
      return;
    }
    if (act === 'finish') return this._finish();
    if (act === 'resume-ack') {
      this._resumedFromDisk = false;
      this.render();
    }
  };

  _current() {
    const ex = this._state.exercises[this._state.exercise_index];
    return ex;
  }

  _adjustWeight(sign) {
    const ex = this._current();
    if (!ex) return;
    ex._w = ex._w ?? this._initialWeightFor(ex);
    ex._w = Math.max(0, (ex._w || 0) + sign * 2.5);
    this._persist();
    this._renderSetCard();
  }

  _adjustReps(sign) {
    const ex = this._current();
    if (!ex) return;
    ex._r = ex._r ?? this._initialRepsFor(ex);
    ex._r = Math.max(0, (ex._r || 0) + sign);
    this._persist();
    this._renderSetCard();
  }

  _setRpe(v) {
    const ex = this._current();
    if (!ex) return;
    ex._rpe = v;
    this._persist();
    this._renderSetCard();
  }

  _initialWeightFor(ex) {
    if (ex._lastSet?.weight_kg != null) return ex._lastSet.weight_kg;
    return 10;
  }

  _initialRepsFor(ex) {
    if (ex._lastSet?.reps != null) return ex._lastSet.reps;
    const m = String(ex.target_reps || '').match(/(\d+)/);
    return m ? Number(m[1]) : 8;
  }

  _doneSet() {
    const ex = this._current();
    if (!ex) return;
    const weight_kg = ex._w ?? this._initialWeightFor(ex);
    const reps = ex._r ?? this._initialRepsFor(ex);
    const rpe = ex._rpe ?? null;
    ex.sets.push({ weight_kg, reps, rpe, datetime: nowUTC() });
    haptics.save();
    this._state.set_index = ex.sets.length;
    this._persist();

    const isLastSet = ex.sets.length >= ex.target_sets;
    const isLastEx = this._state.exercise_index >= this._state.exercises.length - 1;
    if (isLastSet) {
      if (isLastEx) {
        this._goSummary();
        return;
      }
      this._state.exercise_index += 1;
      this._state.set_index = 0;
      this._startRest(ex.rest_s);
      return;
    }
    this._startRest(ex.rest_s);
  }

  _startRest(seconds) {
    this._restTotal = seconds;
    this._restEndsAt = Date.now() + seconds * 1000;
    this._beeped10 = false;
    this._beeped0 = false;
    this.render();
    this._stopTimer();
    this._timer = setInterval(() => this._tickRest(), 250);
  }

  _extendRest(s) {
    if (!this._restEndsAt) return;
    this._restEndsAt += s * 1000;
    this._restTotal += s;
    this._tickRest();
  }

  _finishRest() {
    this._stopTimer();
    this._restEndsAt = 0;
    this.render();
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tickRest() {
    const remaining = Math.max(0, Math.ceil((this._restEndsAt - Date.now()) / 1000));
    if (remaining <= 10 && !this._beeped10) {
      this._beeped10 = true;
      beep(660, 0.1);
      haptics.tap();
    }
    if (remaining <= 0 && !this._beeped0) {
      this._beeped0 = true;
      beep(990, 0.25);
      haptics.done();
      this._finishRest();
      return;
    }
    const ring = this.querySelector('#rest-ring-progress');
    const label = this.querySelector('#rest-label');
    if (ring) {
      const pct = this._restTotal ? remaining / this._restTotal : 0;
      const circ = 2 * Math.PI * 54;
      ring.setAttribute('stroke-dashoffset', String(circ * (1 - pct)));
    }
    if (label) label.textContent = String(remaining);
  }

  _confirmClose() {
    const hasAny = this._state.exercises?.some((e) => e.sets.length > 0);
    if (hasAny && !confirm('Leave session? In-progress sets will be kept for resume.')) return;
    this._persist();
    this._stopTimer();
    this._releaseWakeLock();
    window.location.hash = '#/train';
  }

  _goSummary() {
    this._state.mode = 'summary';
    this._stopTimer();
    this._restEndsAt = 0;
    this.render();
  }

  _setSessionRpe(v) {
    this._state.session_rpe = v;
    this._persist();
    this.render();
  }

  async _finish() {
    const rows = [];
    for (const ex of this._state.exercises) {
      for (const s of ex.sets) {
        rows.push({
          id: uuid(),
          session_id: this._state.id,
          exercise_id: ex.exercise_id,
          datetime: s.datetime,
          weight_kg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
        });
      }
    }
    const duration_s = Math.round((Date.now() - new Date(this._state.started_at).getTime()) / 1000);
    const total_volume_kg = rows.reduce((acc, r) => acc + (r.weight_kg || 0) * (r.reps || 0), 0);
    const session_log = {
      id: this._state.id,
      date: this._state.date,
      phase: this._state.phase,
      session_content_id: this._state.session_content_id,
      type: 'lift',
      started_at: this._state.started_at,
      ended_at: nowUTC(),
      duration_s,
      total_volume_kg,
      session_rpe: this._state.session_rpe,
      n_sets: rows.length,
    };
    await saveCompletedSession({ session_log, training_log_rows: rows });
    this._state.completed = true;
    clearInProgressSession();
    this._releaseWakeLock();
    window.location.hash = '#/train';
  }

  async _hydrateLastSets() {
    for (const ex of this._state.exercises) {
      if (ex._lastSet !== undefined) continue;
      ex._lastSet = (await getLastSetForExercise(ex.exercise_id)) || null;
    }
  }

  async render() {
    if (this._state.empty) {
      this.innerHTML = `
        <section class="view session-view">
          <div class="row" style="margin-bottom:var(--space-3)"><button type="button" class="btn btn-ghost" data-act="close" aria-label="Close">Close</button></div>
          <header class="hero">
            <p class="hero-eyebrow">Session</p>
            <h1 class="hero-title">Rest day</h1>
            <p class="hero-sub">No lift scheduled for your current phase.</p>
          </header>
        </section>
      `;
      return;
    }

    if (this._resumedFromDisk) {
      const started = this._state.started_at
        ? new Date(this._state.started_at).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : '';
      this.innerHTML = `
        <section class="view session-view">
          <header class="hero">
            <p class="hero-eyebrow">Session</p>
            <h1 class="hero-title">Resume?</h1>
            <p class="hero-sub">In-progress session from ${started}.</p>
          </header>
          <button type="button" class="btn btn-hero btn-block" data-act="resume-ack">Resume</button>
          <button type="button" class="btn btn-block btn-secondary" data-act="close" style="margin-top:var(--space-3)">Close</button>
        </section>
      `;
      return;
    }

    if (this._state.mode === 'summary') {
      this._renderSummary();
      return;
    }

    await this._hydrateLastSets();
    const ex = this._current();
    const meta = getExercise(ex.exercise_id);
    const idx = this._state.exercise_index + 1;
    const total = this._state.exercises.length;
    const setN = ex.sets.length + 1;
    const targetStr = `${ex.target_sets} × ${ex.target_reps}${ex._lastSet?.weight_kg ? ` · last ${ex._lastSet.weight_kg}kg × ${ex._lastSet.reps}` : ''}`;

    const restMode = this._restEndsAt > Date.now();
    const circ = 2 * Math.PI * 54;

    this.innerHTML = `
      <section class="view session-view" aria-label="Live training session">
        <div class="row" style="margin-bottom:var(--space-3)">
          <button type="button" class="btn btn-ghost" data-act="close" aria-label="Close session">← Close</button>
          <span class="badge">Set ${setN}/${ex.target_sets}</span>
        </div>
        <header class="hero">
          <p class="hero-eyebrow">Exercise ${idx} of ${total} · Set ${setN} of ${ex.target_sets}</p>
          <h1 class="hero-title">${meta?.name || ex.exercise_id}</h1>
          <p class="hero-sub">Target ${ex.target_sets} × ${ex.target_reps}</p>
        </header>

        ${
          restMode
            ? `
          <div class="rest-card" role="status" aria-live="polite">
            <svg viewBox="0 0 120 120" width="200" height="200" aria-hidden="true">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--bg-3)" stroke-width="8" />
              <circle id="rest-ring-progress" cx="60" cy="60" r="54" fill="none" stroke="var(--accent)" stroke-width="8"
                stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="0"
                transform="rotate(-90 60 60)" />
            </svg>
            <div class="rest-label" id="rest-label">${Math.ceil((this._restEndsAt - Date.now()) / 1000)}</div>
            <p class="muted">Rest</p>
            <div class="cluster" style="justify-content:center">
              <button type="button" class="btn btn-secondary" data-act="add-rest">+30 s</button>
              <button type="button" class="btn btn-hero" data-act="skip-rest">Skip</button>
            </div>
          </div>
        `
            : `
          <div id="set-card" class="set-card" style="border-color:var(--accent)">
            ${this._setCardInner(ex, meta, setN, targetStr)}
          </div>
          <div class="card session-history">
            <div class="row" style="margin-bottom:var(--space-3)">
              <h3 style="margin:0">This session</h3>
              <span class="badge">${ex.sets.length}/${ex.target_sets}</span>
            </div>
            <ul class="stack" style="list-style:none;padding:0;margin:0">
              ${
                ex.sets.length
                  ? ex.sets
                      .map(
                        (s, i) =>
                          `<li class="row"><span>Set ${i + 1}</span><span class="muted">${s.weight_kg}kg × ${s.reps}${s.rpe ? ` @ ${s.rpe}` : ''}</span></li>`,
                      )
                      .join('')
                  : '<li class="muted">No sets logged yet</li>'
              }
            </ul>
          </div>
          <button type="button" class="btn btn-hero btn-block done-set" data-act="done-set">DONE SET</button>
        `
        }
      </section>
    `;

    if (restMode) this._tickRest();
  }

  _setCardInner(ex, meta, setN, targetStr) {
    const w = ex._w ?? this._initialWeightFor(ex);
    const r = ex._r ?? this._initialRepsFor(ex);
    const rpe = ex._rpe ?? null;
    const rpeRow = [6, 7, 8, 9, 10]
      .map(
        (v) =>
          `<button type="button" class="chip${rpe === v ? ' active' : ''}" data-act="rpe" data-rpe="${v}" aria-pressed="${rpe === v}">${v}</button>`,
      )
      .join('');
    const whyLink = meta?.evidence_id
      ? `<a href="#" data-evidence-id="${meta.evidence_id}">why →</a>`
      : '';
    return `
      <div class="row" style="margin-bottom:var(--space-2)">
        <span class="muted">Set ${setN} · target ${targetStr}</span>
        ${whyLink}
      </div>
      <div class="stepper" role="group" aria-label="Weight in kg">
        <button type="button" class="btn btn-secondary" data-act="weight-" aria-label="Decrease weight">−</button>
        <div class="stepper-value"><strong>${w}</strong><span class="muted"> kg</span></div>
        <button type="button" class="btn btn-secondary" data-act="weight+" aria-label="Increase weight">+</button>
      </div>
      <div class="stepper" role="group" aria-label="Reps">
        <button type="button" class="btn btn-secondary" data-act="reps-" aria-label="Decrease reps">−</button>
        <div class="stepper-value"><strong>${r}</strong><span class="muted"> reps</span></div>
        <button type="button" class="btn btn-secondary" data-act="reps+" aria-label="Increase reps">+</button>
      </div>
      <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
        <span class="muted" style="width:100%">RPE (RIR ${rpe != null ? Math.max(0, 10 - rpe) : '—'})</span>
        ${rpeRow}
      </div>
    `;
  }

  _renderSetCard() {
    const host = this.querySelector('#set-card');
    if (!host) return;
    const ex = this._current();
    const meta = getExercise(ex.exercise_id);
    const setN = ex.sets.length + 1;
    const targetStr = `${ex.target_sets} × ${ex.target_reps}`;
    host.innerHTML = this._setCardInner(ex, meta, setN, targetStr);
  }

  _renderSummary() {
    const rows = [];
    let volume = 0;
    for (const ex of this._state.exercises) {
      for (const s of ex.sets) {
        rows.push({ ex, s });
        volume += (s.weight_kg || 0) * (s.reps || 0);
      }
    }
    const minutes = Math.round((Date.now() - new Date(this._state.started_at).getTime()) / 60000);
    const srpe = this._state.session_rpe;
    const srpeChips = [6, 7, 8, 9, 10]
      .map(
        (v) =>
          `<button type="button" class="chip${srpe === v ? ' active' : ''}" data-act="session-rpe" data-srpe="${v}">${v}</button>`,
      )
      .join('');
    this.innerHTML = `
      <section class="view session-view">
        <div class="row" style="margin-bottom:var(--space-3)">
          <button type="button" class="btn btn-ghost" data-act="close" aria-label="Close">← Close</button>
        </div>
        <header class="hero">
          <p class="hero-eyebrow">Session complete</p>
          <h1 class="hero-title">Nice work</h1>
          <p class="hero-sub">${rows.length} sets · ${minutes} min</p>
        </header>

        <div class="kpi-grid">
          <div class="kpi-tile">
            <span class="kpi-label">Volume</span>
            <span class="kpi">${Math.round(volume)}<span class="kpi-unit">kg</span></span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Duration</span>
            <span class="kpi">${minutes}<span class="kpi-unit">min</span></span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Sets</span>
            <span class="kpi">${rows.length}</span>
          </div>
        </div>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 style="margin:0">Session RPE</h3>
          </div>
          <div class="cluster">${srpeChips}</div>
        </article>
        <button type="button" class="btn btn-hero btn-block" data-act="finish" ${srpe == null ? 'disabled' : ''}>Save session</button>
      </section>
    `;
  }
}

customElements.define('jamie-train-session', JamieTrainSession);
