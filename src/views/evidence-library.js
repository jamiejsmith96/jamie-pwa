/*
 * <jamie-evidence-library> — browsable list of all evidence rows (UX §6.15).
 * Tap a row to open <jamie-evidence> modal.
 */

import { getAllEvidence } from '../lib/content.js';
import { openEvidence } from './evidence-modal.js';

class JamieEvidenceLibrary extends HTMLElement {
  constructor() {
    super();
    this._query = '';
  }
  connectedCallback() {
    this.render();
  }

  render() {
    const all = getAllEvidence();
    const q = this._query.toLowerCase();
    const filtered = q
      ? all.filter((e) =>
          [e.author_year, e.outcome, e.intervention, e.domain, e.notes]
            .filter(Boolean)
            .some((s) => s.toLowerCase().includes(q)),
        )
      : all;
    this.innerHTML = `
      <section class="view">
        <header class="hero">
          <p class="hero-eyebrow">Library</p>
          <h1 class="hero-title">Evidence</h1>
          <p class="hero-sub">${filtered.length} of ${all.length} rows</p>
        </header>
        <article class="card">
          <div class="field" style="margin-bottom:0">
            <label class="label" for="ev-q">Search</label>
            <input id="ev-q" class="input" type="search" placeholder="Author, outcome, domain" value="${esc(this._query)}" />
          </div>
        </article>
        <div class="stack">
          ${filtered
            .map(
              (e) => `
            <article class="card card-link" data-ev="${e.id}" role="button" tabindex="0">
              <div class="row" style="margin-bottom:var(--space-2)">
                <strong>${esc(e.outcome || e.intervention || e.domain || 'Evidence')}</strong>
                <span class="cluster">
                  <span class="badge tier-${(e.tier || 't6').toLowerCase()}">${e.tier || ''}</span>
                  <span class="badge badge-grade">${e.grade || ''}</span>
                </span>
              </div>
              <p class="muted" style="margin:0">${esc(e.author_year || '')}${e.intervention ? ` · ${esc(e.intervention)}` : ''}</p>
            </article>`,
            )
            .join('')}
        </div>
      </section>
    `;
    this.querySelector('#ev-q').addEventListener('input', (e) => {
      this._query = e.target.value;
      this.render();
      this.querySelector('#ev-q')?.focus();
    });
    this.querySelectorAll('[data-ev]').forEach((el) => {
      el.addEventListener('click', () => openEvidence(el.dataset.ev));
    });
  }
}

function esc(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

customElements.define('jamie-evidence-library', JamieEvidenceLibrary);
