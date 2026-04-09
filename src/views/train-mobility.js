/*
 * <jamie-train-mobility>
 *
 * Simple timed mobility block list. Pulls from content.guides.training
 * (looking for a "mobility" section); if none is present, falls back to
 * a short default routine. Marking a block complete writes a
 * session_log row with type='mobility'.
 */

import { nowUTC, todayISO } from '../lib/dates.js';
import { getDB, uuid } from '../lib/db.js';
import { haptics } from '../lib/haptics.js';

const DEFAULT_BLOCKS = [
  { name: 'Thoracic spine rotations', seconds: 60 },
  { name: 'Hip 90/90', seconds: 90 },
  { name: 'Ankle dorsiflexion rocks', seconds: 60 },
  { name: 'Cat–cow', seconds: 60 },
  { name: 'Deep squat hold', seconds: 60 },
];

class JamieTrainMobility extends HTMLElement {
  connectedCallback() {
    this._blocks = DEFAULT_BLOCKS;
    this._state = this._blocks.map(() => ({ done: false, running: false, remaining: 0 }));
    this._timers = [];
    this.render();
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this._timers.forEach(clearInterval);
    this.removeEventListener('click', this._onClick);
  }

  _onClick = async (e) => {
    const act = e.target.closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    const i = Number(e.target.closest('[data-idx]')?.getAttribute('data-idx'));
    if (act === 'start' && Number.isFinite(i)) this._startBlock(i);
    if (act === 'done' && Number.isFinite(i)) this._markDone(i);
    if (act === 'finish') this._finishSession();
  };

  _startBlock(i) {
    const s = this._state[i];
    if (s.running) return;
    s.running = true;
    s.remaining = this._blocks[i].seconds;
    this._renderRow(i);
    const id = setInterval(() => {
      s.remaining -= 1;
      if (s.remaining <= 0) {
        clearInterval(id);
        s.running = false;
        s.done = true;
        haptics.done();
      }
      this._renderRow(i);
    }, 1000);
    this._timers.push(id);
  }

  _markDone(i) {
    this._state[i].done = true;
    this._renderRow(i);
  }

  async _finishSession() {
    const db = await getDB();
    await db.put('session_log', {
      id: uuid(),
      date: todayISO(),
      type: 'mobility',
      started_at: nowUTC(),
      ended_at: nowUTC(),
      n_blocks: this._state.filter((s) => s.done).length,
    });
    window.dispatchEvent(new CustomEvent('jamie:data-changed'));
    haptics.save();
    window.location.hash = '#/train';
  }

  _renderRow(i) {
    const row = this.querySelector(`#mob-${i}`);
    if (!row) return;
    row.outerHTML = this._rowHtml(i);
  }

  _rowHtml(i) {
    const b = this._blocks[i];
    const s = this._state[i];
    return `
      <article id="mob-${i}" class="card" data-idx="${i}">
        <div class="row">
          <strong>${b.name}</strong>
          <span class="muted">${s.running ? `${s.remaining}s` : `${b.seconds}s`}</span>
        </div>
        <div class="row" style="gap:var(--space-2);margin-top:var(--space-3)">
          ${s.done ? '<span class="saved">done</span>' : ''}
          <button type="button" class="btn btn-secondary" data-act="start" data-idx="${i}" ${s.running || s.done ? 'disabled' : ''}>Start</button>
          <button type="button" class="btn" data-act="done" data-idx="${i}" ${s.done ? 'disabled' : ''}>Mark done</button>
        </div>
      </article>
    `;
  }

  render() {
    const anyDone = this._state.some((s) => s.done);
    this.innerHTML = `
      <div>
        <p class="muted">Short mobility routine. Start each block or mark done.</p>
        ${this._blocks.map((_, i) => this._rowHtml(i)).join('')}
        <button type="button" class="btn btn-block" data-act="finish" ${anyDone ? '' : 'disabled'}>Finish</button>
      </div>
    `;
  }
}

customElements.define('jamie-train-mobility', JamieTrainMobility);
