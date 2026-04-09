/*
 * <jamie-recipe-detail> — recipe modal (v1 spec §5.3, UX §6.11)
 *
 * Slide-up ion-modal. Portion toggle 1/2/4, macros per serving and per 100 g,
 * ingredients, method, shopping-list copy, "Log this meal" writes to
 * nutrition_log with source: "manual-recipe".
 */

import { getRecipe } from '../lib/content.js';
import { addNutritionLog } from '../lib/db.js';

class JamieRecipeDetail extends HTMLElement {
  constructor() {
    super();
    this._portions = 1;
    this._toast = '';
  }

  connectedCallback() {
    this.render();
  }

  close() {
    if (this._modal) this._modal.isOpen = false;
  }

  render() {
    const id = this.getAttribute('recipe-id');
    const r = id ? getRecipe(id) : null;

    // ion-modal teleports out of the host to <body>, so we keep a reference
    // on `this._modal` rather than querying. Re-renders for portion changes
    // reuse the same modal to avoid remount.
    const firstRender = !this._modal;
    if (firstRender) {
      this.innerHTML = '';
      this._modal = document.createElement('ion-modal');
      this._modal.addEventListener('didDismiss', () => this.remove());
      this.appendChild(this._modal);
    }
    const modal = this._modal;

    if (!r) {
      modal.innerHTML = `
        <ion-content class="ion-padding">
          <p class="muted">Recipe not found.</p>
          <button type="button" class="btn" data-act="close">Close</button>
        </ion-content>`;
      this.wire(firstRender);
      return;
    }
    const mult = this._portions;
    const m = r.macros_per_serving || {};
    const m100 = r.macros_per_100g || {};

    modal.innerHTML = `
      <ion-content class="ion-padding">
        <div class="view">
          <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <h2 style="margin:0;font-size:var(--type-lg);flex:1;padding-right:var(--space-3)">${esc(r.name)}</h2>
            <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
          </div>
          <p class="muted" style="margin:0 0 var(--space-4)">${r.cuisine || ''} · ${r.time_min || 0} min · ${r.cost_tier || ''} · fridge ${r.fridge_days || 0} d</p>

          <div class="kpi-grid">
            <div class="kpi-tile">
              <span class="kpi-label">kcal</span>
              <span class="kpi">${Math.round((m.kcal || 0) * mult)}</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Protein</span>
              <span class="kpi">${round1((m.p || 0) * mult)}<span class="kpi-unit">g</span></span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-label">Carbs</span>
              <span class="kpi">${round1((m.c || 0) * mult)}<span class="kpi-unit">g</span></span>
            </div>
          </div>

          <div class="field">
            <label class="label">Portions</label>
            <div class="segmented">
              ${[1, 2, 4]
                .map(
                  (p) =>
                    `<button type="button" class="seg-btn ${p === mult ? 'active' : ''}" data-portions="${p}">${p}x</button>`,
                )
                .join('')}
            </div>
          </div>

          <article class="card">
            <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Macros</h3><span class="badge">${mult}x serving</span></div>
            <table style="width:100%;font-size:var(--type-sm)">
              <thead><tr><th></th><th style="text-align:right">Per serving</th><th style="text-align:right">Per 100 g</th></tr></thead>
              <tbody>
                <tr><td>kcal</td><td style="text-align:right">${Math.round((m.kcal || 0) * mult)}</td><td style="text-align:right">${Math.round(m100.kcal || 0)}</td></tr>
                <tr><td>Protein</td><td style="text-align:right">${round1((m.p || 0) * mult)} g</td><td style="text-align:right">${round1(m100.p || 0)} g</td></tr>
                <tr><td>Carbs</td><td style="text-align:right">${round1((m.c || 0) * mult)} g</td><td style="text-align:right">${round1(m100.c || 0)} g</td></tr>
                <tr><td>Fat</td><td style="text-align:right">${round1((m.f || 0) * mult)} g</td><td style="text-align:right">${round1(m100.f || 0)} g</td></tr>
                <tr><td>Fibre</td><td style="text-align:right">${round1((m.fibre || 0) * mult)} g</td><td style="text-align:right">${round1(m100.fibre || 0)} g</td></tr>
              </tbody>
            </table>
          </article>

          <div class="section-head"><h2>Ingredients</h2></div>
          <article class="card">
            <ul style="margin:0;padding-left:var(--space-4)">
              ${(r.ingredients || [])
                .map(
                  (i) =>
                    `<li>${esc(i.name || i.item || '')} — ${round1((i.grams || 0) * mult)} g${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}</li>`,
                )
                .join('')}
            </ul>
          </article>

          <div class="section-head"><h2>Method</h2></div>
          <article class="card">
            <ol style="margin:0;padding-left:var(--space-4)">
              ${(r.method_steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}
            </ol>
          </article>

          ${
            r.equipment_required?.length
              ? `<div class="section-head"><h2>Equipment</h2></div>
                 <article class="card"><p class="muted" style="margin:0">${r.equipment_required.join(', ')}</p></article>`
              : ''
          }

          <div class="stack" style="margin-top:var(--space-4)">
            <button type="button" class="btn btn-hero btn-block" data-act="log">Log this meal</button>
            <button type="button" class="btn btn-secondary btn-block" data-act="shopping">Copy shopping list</button>
          </div>
          ${this._toast ? `<p class="muted" style="text-align:center;margin-top:var(--space-2)">${esc(this._toast)}</p>` : ''}
        </div>
      </ion-content>
    `;
    this.wire(firstRender);
  }

  wire(firstRender) {
    const modal = this._modal;
    if (firstRender && modal) modal.isOpen = true;
    modal?.querySelectorAll('[data-portions]').forEach((b) => {
      b.addEventListener('click', () => {
        this._portions = Number(b.dataset.portions);
        this.render();
      });
    });
    modal?.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    modal
      ?.querySelector('[data-act="shopping"]')
      ?.addEventListener('click', () => this.copyShopping());
    modal?.querySelector('[data-act="log"]')?.addEventListener('click', () => this.logMeal());
  }

  async copyShopping() {
    const id = this.getAttribute('recipe-id');
    const r = getRecipe(id);
    if (!r) return;
    const mult = this._portions;
    const lines = (r.ingredients || []).map(
      (i) => `- ${i.name || i.item || ''} — ${round1((i.grams || 0) * mult)} g`,
    );
    const text = `${r.name} (${mult} portion${mult > 1 ? 's' : ''})\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      this._toast = 'Copied shopping list to clipboard.';
    } catch {
      this._toast = 'Clipboard unavailable — please copy manually.';
    }
    this.render();
  }

  async logMeal() {
    const id = this.getAttribute('recipe-id');
    const r = getRecipe(id);
    if (!r) return;
    const mult = this._portions;
    const m = r.macros_per_serving || {};
    const scaled = {
      kcal: (m.kcal || 0) * mult,
      p: (m.p || 0) * mult,
      c: (m.c || 0) * mult,
      f: (m.f || 0) * mult,
      fibre: (m.fibre || 0) * mult,
    };
    await addNutritionLog({
      datetime: new Date().toISOString(),
      meal: r.category === 'breakfast' ? 1 : r.category === 'snack' ? 'snack' : 2,
      name: r.name,
      kcal: scaled.kcal,
      p: scaled.p,
      c: scaled.c,
      f: scaled.f,
      fibre: scaled.fibre,
      food_items: [
        {
          name: r.name,
          grams: (r.serving_weight_g || 0) * mult,
          protein: scaled.p,
          carbs: scaled.c,
          fat: scaled.f,
          kcal: scaled.kcal,
        },
      ],
      source: 'manual-recipe',
      recipe_id: r.id,
      portions: mult,
    });
    this.close();
  }
}

function esc(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

customElements.define('jamie-recipe-detail', JamieRecipeDetail);
