/*
 * <jamie-evidence> — evidence drawer
 *
 * Slides up from the bottom. Reusable from any "why →" link that carries
 * a `data-evidence-id` attribute. Renders the row from content.evidence
 * with tier/GRADE badges and a PubMed deep link.
 *
 * Usage:
 *   const el = document.createElement('jamie-evidence');
 *   el.setAttribute('evidence-id', 'schoenfeld_2017');
 *   document.body.appendChild(el);
 *   el.open();
 */

import { getEvidence } from '../lib/content.js';

const TIER_CLASS = {
  T1: 'tier-t1',
  T2: 'tier-t2',
  T3: 'tier-t3',
  T4: 'tier-t4',
  T5: 'tier-t5',
  T6: 'tier-t6',
};

function extractPMID(pmidDoi) {
  if (!pmidDoi) return null;
  const m = String(pmidDoi).match(/PMID\s*:?\s*(\d+)/i);
  return m ? m[1] : null;
}

class JamieEvidence extends HTMLElement {
  static get observedAttributes() {
    return ['evidence-id'];
  }

  constructor() {
    super();
    this._modal = null;
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  async open() {
    if (this._modal) this._modal.isOpen = true;
  }

  close() {
    if (this._modal) this._modal.isOpen = false;
  }

  render() {
    const id = this.getAttribute('evidence-id');
    const ev = id ? getEvidence(id) : null;

    this.innerHTML = '';
    const modal = document.createElement('ion-modal');
    this._modal = modal;
    modal.addEventListener('didDismiss', () => this.remove());

    if (!ev) {
      modal.innerHTML = `
        <ion-content class="ion-padding">
          <p class="muted">Evidence not found.</p>
          <button type="button" class="btn btn-block" data-act="close">Close</button>
        </ion-content>
      `;
    } else {
      const pmid = extractPMID(ev.pmid_doi);
      const pmidLink = pmid
        ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}" target="_blank" rel="noopener noreferrer">PMID ${pmid}</a>`
        : `<span class="muted">${ev.pmid_doi || ''}</span>`;
      modal.innerHTML = `
        <ion-content class="ion-padding">
        <div class="view evidence-drawer" role="dialog" aria-labelledby="evidence-title">
          <div class="row" style="margin-bottom:var(--space-3)">
            <div class="evidence-badges">
              <span class="badge ${TIER_CLASS[ev.tier] || ''}">${ev.tier || ''}</span>
              <span class="badge badge-grade">${ev.grade || ''}</span>
            </div>
            <button type="button" class="btn btn-ghost" data-act="close" aria-label="Close">← Close</button>
          </div>
          <header class="hero">
            <p class="hero-eyebrow">Evidence · ${ev.tier || ''}</p>
            <h1 id="evidence-title" class="hero-title">${ev.author_year || ''}</h1>
            <p class="hero-sub">${ev.design || ''}${ev.n ? ` · n=${ev.n}` : ''}</p>
          </header>

          <article class="card">
            <dl class="evidence-list">
              ${ev.population ? `<dt>Population</dt><dd>${ev.population}</dd>` : ''}
              ${ev.intervention ? `<dt>Intervention</dt><dd>${ev.intervention}</dd>` : ''}
              ${ev.comparator ? `<dt>Comparator</dt><dd>${ev.comparator}</dd>` : ''}
              ${ev.outcome ? `<dt>Outcome</dt><dd>${ev.outcome}</dd>` : ''}
              ${ev.effect ? `<dt>Effect</dt><dd>${ev.effect}</dd>` : ''}
              ${ev.follow_up ? `<dt>Follow-up</dt><dd>${ev.follow_up}</dd>` : ''}
              ${ev.funding ? `<dt>Funding</dt><dd>${ev.funding}</dd>` : ''}
              ${ev.rob ? `<dt>Risk of bias</dt><dd>${ev.rob}</dd>` : ''}
              ${ev.notes ? `<dt>Notes</dt><dd>${ev.notes}</dd>` : ''}
              <dt>Source</dt><dd>${pmidLink}</dd>
            </dl>
          </article>
        </div>
        </ion-content>
      `;
    }

    this.appendChild(modal);
    const close = modal.querySelector('[data-act="close"]');
    if (close) close.addEventListener('click', () => this.close());
    modal.isOpen = true;
  }
}

customElements.define('jamie-evidence', JamieEvidence);

/**
 * Convenience: open evidence drawer by id, appending to <body>.
 */
export function openEvidence(id) {
  const el = document.createElement('jamie-evidence');
  el.setAttribute('evidence-id', id);
  document.body.appendChild(el);
}

// Global delegated handler so any element with [data-evidence-id] opens it.
if (typeof document !== 'undefined' && !window.__jamieEvidenceWired) {
  window.__jamieEvidenceWired = true;
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-evidence-id]');
    if (!target) return;
    e.preventDefault();
    openEvidence(target.getAttribute('data-evidence-id'));
  });
}
