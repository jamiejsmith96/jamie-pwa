/*
 * <jamie-guides> — markdown guide viewer (UX §6.14)
 *
 * Lazy-imports marked. Transforms [[pmid:12345]] tokens into tappable pills.
 * Tabs: phase0, sleep, smoking, nutrition, training, tracking, addendum, literature.
 * Footer on every guide: "Evidence synthesis, not medical advice."
 */

import { getAllEvidence, getGuide } from '../lib/content.js';

const GUIDES = [
  { key: 'phase0', label: 'Phase 0' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'smoking', label: 'Smoking' },
  { key: 'nutrition', label: 'Nutrition' },
  { key: 'training', label: 'Training' },
  { key: 'tracking', label: 'Tracking' },
  { key: 'addendum', label: 'Addendum' },
  { key: 'literature', label: 'Literature' },
];

let markedMod = null;
async function getMarked() {
  if (markedMod) return markedMod;
  const m = await import('marked');
  markedMod = m.marked || m.default || m;
  return markedMod;
}

function transformPmidTokens(md, evidence) {
  // [[pmid:12345]] -> tappable span
  return md.replace(/\[\[pmid:(\d+)\]\]/g, (_, pmid) => {
    const ev = evidence.find((e) => (e.pmid_doi || '').includes(pmid));
    if (ev) {
      return `<a href="#" class="evidence-pill" data-evidence-id="${ev.id}">PMID ${pmid}</a>`;
    }
    return `<a class="evidence-pill" target="_blank" rel="noopener" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}">PMID ${pmid}</a>`;
  });
}

class JamieGuides extends HTMLElement {
  constructor() {
    super();
    this._key = this.getAttribute('guide-key') || 'phase0';
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['guide-key'];
  }
  attributeChangedCallback(name, _o, v) {
    if (name === 'guide-key' && v) {
      this._key = v;
      if (this.isConnected) this.render();
    }
  }

  async render() {
    const current = GUIDES.find((g) => g.key === this._key);
    this.innerHTML = `
      <section class="view">
        <header class="hero">
          <p class="hero-eyebrow">Guides</p>
          <h1 class="hero-title">${current?.label || 'Guides'}</h1>
          <p class="hero-sub">Evidence synthesis, not medical advice.</p>
        </header>
        <div class="cluster" style="margin-bottom:var(--space-4)">
          ${GUIDES.map(
            (g) =>
              `<button type="button" class="chip ${g.key === this._key ? 'active' : ''}" data-key="${g.key}">${g.label}</button>`,
          ).join('')}
        </div>
        <article id="guide-body" class="card"><p class="muted">Loading…</p></article>
      </section>
    `;
    this.querySelectorAll('[data-key]').forEach((b) => {
      b.addEventListener('click', () => {
        this._key = b.dataset.key;
        window.location.hash = `#/guides/${this._key}`;
        this.render();
      });
    });
    const host = this.querySelector('#guide-body');
    const md = getGuide(this._key);
    if (!md) {
      host.innerHTML = '<p class="muted">Guide not found.</p>';
      return;
    }
    const marked = await getMarked();
    const transformed = transformPmidTokens(md, getAllEvidence());
    host.innerHTML = marked.parse(transformed);
  }
}

customElements.define('jamie-guides', JamieGuides);
