/*
 * <jamie-exercise-library>
 *
 * Searchable card list of all exercises from content.json. Each card
 * exposes muscle/setup/execution/mistakes plus a "Watch video" link that
 * opens a YouTube results page in a new tab (offline-safe: it's just a
 * hyperlink). Used from Train menu and from the swap flow inside a
 * live session (via a `data-swap` flag on the host).
 */

import { getAllExercises } from '../lib/content.js';

class JamieExerciseLibrary extends HTMLElement {
  connectedCallback() {
    this._q = '';
    this.render();
    this.addEventListener('input', this._onInput);
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('input', this._onInput);
    this.removeEventListener('click', this._onClick);
  }

  _onInput = (e) => {
    if (e.target?.id === 'ex-search') {
      this._q = (e.target.value || '').toLowerCase();
      this._renderList();
    }
  };

  _onClick = (e) => {
    const swap = e.target.closest('[data-swap-to]');
    if (swap) {
      const id = swap.getAttribute('data-swap-to');
      this.dispatchEvent(
        new CustomEvent('jamie:swap-exercise', { detail: { exercise_id: id }, bubbles: true }),
      );
    }
  };

  render() {
    this.innerHTML = `
      <section class="view" aria-labelledby="lib-title">
        <header class="hero">
          <p class="hero-eyebrow">Library</p>
          <h1 id="lib-title" class="hero-title">Exercises</h1>
          <p class="hero-sub">Form cues, swaps, video references.</p>
        </header>
        <article class="card">
          <div class="field" style="margin-bottom:0">
            <label class="label" for="ex-search">Search</label>
            <input id="ex-search" class="input" type="text" placeholder="Muscle or name" autocomplete="off" />
          </div>
        </article>
        <div id="ex-list" class="stack"></div>
      </section>
    `;
    this._renderList();
  }

  _renderList() {
    const host = this.querySelector('#ex-list');
    if (!host) return;
    const q = this._q;
    const items = getAllExercises().filter((e) => {
      if (!q) return true;
      return (e.name || '').toLowerCase().includes(q) || (e.muscle || '').toLowerCase().includes(q);
    });
    const swapMode = this.hasAttribute('data-swap');
    host.innerHTML = items
      .map((e) => {
        const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(
          e.video_search || `${e.name} form tutorial`,
        )}`;
        return `
          <article class="card" aria-labelledby="ex-${e.id}">
            <div class="row" style="margin-bottom:var(--space-2)">
              <h3 id="ex-${e.id}" style="margin:0">${e.name}</h3>
              ${e.muscle ? `<span class="badge">${e.muscle}</span>` : ''}
            </div>
            ${e.setup ? `<p><strong>Setup.</strong> ${e.setup}</p>` : ''}
            ${e.execution ? `<p><strong>Execution.</strong> ${e.execution}</p>` : ''}
            ${e.mistakes ? `<p><strong>Mistakes.</strong> ${e.mistakes}</p>` : ''}
            <div class="cluster">
              <a class="btn btn-secondary" href="${yt}" target="_blank" rel="noopener noreferrer">Watch video</a>
              ${swapMode ? `<button type="button" class="btn btn-hero" data-swap-to="${e.id}">Use this</button>` : ''}
            </div>
          </article>
        `;
      })
      .join('');
  }
}

customElements.define('jamie-exercise-library', JamieExerciseLibrary);
