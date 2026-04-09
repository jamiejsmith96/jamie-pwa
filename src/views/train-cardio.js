/*
 * <jamie-train-cardio>
 *
 * Manual log form (distance, duration, HR, notes, type) + history list,
 * plus a 10-20-30 interval timer (3 blocks × 5 reps × 30s easy / 20s
 * moderate / 10s all-out, 2 min rest between blocks). Phase changes
 * produce an oscillator beep and a haptic pulse.
 */

import { addCardioLog, getAllCardioLogs, uuid } from '../lib/db.js';
import { nowUTC } from '../lib/dates.js';
import { haptics } from '../lib/haptics.js';

const PHASES = [
  { label: 'Easy', s: 30, freq: 440 },
  { label: 'Moderate', s: 20, freq: 660 },
  { label: 'All-out', s: 10, freq: 990 },
];

function beep(freq = 880, duration = 0.15) {
  try {
    const ctx = beep._ctx || (beep._ctx = new (window.AudioContext || window.webkitAudioContext)());
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
    /* ignore */
  }
}

class JamieTrainCardio extends HTMLElement {
  connectedCallback() {
    this._timer = null;
    this._interval = null;
    this.render();
    this.addEventListener('click', this._onClick);
    this.addEventListener('change', this._onChange);
  }

  disconnectedCallback() {
    this._stopInterval();
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('change', this._onChange);
  }

  _onClick = async (e) => {
    const act = e.target.closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    if (act === 'save') return this._saveManual();
    if (act === 'start-1020-30') return this._startInterval();
    if (act === 'stop-1020-30') return this._stopInterval();
  };

  _onChange = () => {};

  async _saveManual() {
    const form = this.querySelector('#cardio-form');
    if (!form) return;
    const data = new FormData(form);
    const row = {
      id: uuid(),
      datetime: nowUTC(),
      type: data.get('type') || 'other',
      distance_m: Number(data.get('distance_m')) || null,
      duration_min: Number(data.get('duration_min')) || null,
      avg_hr: Number(data.get('avg_hr')) || null,
      notes: data.get('notes') || '',
    };
    await addCardioLog(row);
    haptics.save();
    form.reset();
    this.render();
  }

  _startInterval() {
    this._interval = {
      block: 1,
      rep: 1,
      phase: 0,
      phaseStart: Date.now(),
      resting: false,
    };
    this._tickInterval();
    this._timer = setInterval(() => this._tickInterval(), 250);
  }

  _stopInterval() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._interval = null;
    this.render();
  }

  _tickInterval() {
    const st = this._interval;
    if (!st) return;
    const now = Date.now();
    if (st.resting) {
      const elapsed = (now - st.phaseStart) / 1000;
      const remaining = Math.max(0, 120 - elapsed);
      this._renderIntervalCue(`Block rest · ${Math.ceil(remaining)}s`, remaining);
      if (remaining <= 0) {
        st.resting = false;
        st.block += 1;
        st.rep = 1;
        st.phase = 0;
        st.phaseStart = now;
        if (st.block > 3) {
          beep(990, 0.4);
          haptics.done();
          this._stopInterval();
          return;
        }
        beep(660, 0.2);
        haptics.tap();
      }
      return;
    }
    const cur = PHASES[st.phase];
    const elapsed = (now - st.phaseStart) / 1000;
    const remaining = Math.max(0, cur.s - elapsed);
    this._renderIntervalCue(
      `Block ${st.block}/3 · Rep ${st.rep}/5 · ${cur.label} ${Math.ceil(remaining)}s`,
      remaining,
    );
    if (remaining <= 0) {
      beep(cur.freq, 0.15);
      haptics.tap();
      st.phase += 1;
      if (st.phase >= PHASES.length) {
        st.phase = 0;
        st.rep += 1;
        if (st.rep > 5) {
          st.resting = true;
          st.phaseStart = now;
          return;
        }
      }
      st.phaseStart = now;
    }
  }

  _renderIntervalCue(text) {
    const cue = this.querySelector('#interval-cue');
    if (cue) cue.textContent = text;
  }

  async render() {
    const history = (await getAllCardioLogs()).sort((a, b) =>
      (b.datetime || '').localeCompare(a.datetime || ''),
    );
    const running = !!this._interval;
    this.innerHTML = `
      <div>
        <article class="card">
          <h2>Log cardio</h2>
          <form id="cardio-form" onsubmit="return false">
            <div class="field">
              <label class="label" for="c-type">Type</label>
              <select id="c-type" name="type" class="input">
                <option value="z2">Zone 2</option>
                <option value="10_20_30">10-20-30 intervals</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="c-dist">Distance (m)</label>
              <input id="c-dist" name="distance_m" type="number" inputmode="decimal" min="0" />
            </div>
            <div class="field">
              <label class="label" for="c-dur">Duration (min)</label>
              <input id="c-dur" name="duration_min" type="number" inputmode="decimal" min="0" />
            </div>
            <div class="field">
              <label class="label" for="c-hr">Average HR (bpm)</label>
              <input id="c-hr" name="avg_hr" type="number" inputmode="numeric" min="0" />
            </div>
            <div class="field">
              <label class="label" for="c-notes">Notes</label>
              <input id="c-notes" name="notes" type="text" />
            </div>
            <button type="button" class="btn btn-block" data-act="save">Save</button>
          </form>
        </article>

        <article class="card">
          <h2>10-20-30 intervals</h2>
          <p class="muted">3 blocks × 5 reps × (30s easy / 20s moderate / 10s all-out), 2 min between blocks.</p>
          <p id="interval-cue" aria-live="polite" style="text-align:center;font-size:var(--type-lg)">${running ? 'Starting…' : 'Ready'}</p>
          ${
            running
              ? `<button type="button" class="btn btn-block btn-secondary" data-act="stop-1020-30">Stop</button>`
              : `<button type="button" class="btn btn-block" data-act="start-1020-30">Start</button>`
          }
        </article>

        <article class="card">
          <h2>History</h2>
          ${
            history.length
              ? `<ul class="stack" style="list-style:none;padding:0;margin:0">${history
                  .map(
                    (r) =>
                      `<li class="row"><span>${(r.datetime || '').slice(0, 10)} · ${r.type}</span><span class="muted">${r.distance_m ? `${r.distance_m} m` : ''} ${r.duration_min ? `${r.duration_min} min` : ''}</span></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted">No cardio logged yet.</p>'
          }
        </article>
      </div>
    `;
  }
}

customElements.define('jamie-train-cardio', JamieTrainCardio);
