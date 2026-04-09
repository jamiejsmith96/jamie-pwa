/*
 * <jamie-eat> — Eat view (single-screen tracker + suggestions)
 *
 * One screen, no sub-tabs:
 *   1. Targets — eaten vs target with progress bars (nutrition_log for today)
 *   2. Logged today — list of meals logged today, tap-to-remove
 *   3. What next — recipes ranked by fit to remaining macros, with a
 *      "Browse all" toggle that flips into the full filterable cookbook.
 *
 * Logging happens in <jamie-recipe-detail>. This view listens for
 * `jamie:data-changed` to re-render immediately.
 */

import { content, getRecipe, getRecipesFiltered } from '../lib/content.js';
import { todayISO } from '../lib/dates.js';
import { deleteNutritionLog, getNutritionLogsForDate } from '../lib/db.js';
import { buildSuggestContext, explainContext, suggestDayPlan } from '../lib/meal-suggest.js';
import { loadSettings, updateSettings } from '../lib/settings.js';
import './recipe-detail.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

class JamieEat extends HTMLElement {
  constructor() {
    super();
    this._mode = 'suggest'; // 'suggest' | 'browse'
    const s = loadSettings();
    this._filters = {
      query: '',
      category: '',
      cuisine: '',
      method: '',
      maxTime: 0,
      phase_fit: '',
      protein_tier: '',
      cost_tier: '',
      sort: 'name',
      ...(s.recipe_filters || {}),
    };
  }

  connectedCallback() {
    this._onData = () => this.render();
    window.addEventListener('jamie:data-changed', this._onData);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('jamie:data-changed', this._onData);
  }

  persistFilters() {
    updateSettings({ recipe_filters: this._filters });
  }

  async render() {
    const s = loadSettings();
    const proteinTarget = s.protein_target_g || 120;
    const kcalTarget = s.kcal_target || 2400;

    const logs = await getNutritionLogsForDate(todayISO());
    const eaten = logs.reduce(
      (acc, r) => {
        acc.kcal += r.kcal || 0;
        acc.p += r.p || 0;
        acc.c += r.c || 0;
        acc.f += r.f || 0;
        return acc;
      },
      { kcal: 0, p: 0, c: 0, f: 0 },
    );

    const pPct = Math.min(100, Math.round((eaten.p / proteinTarget) * 100));
    const kPct = Math.min(100, Math.round((eaten.kcal / kcalTarget) * 100));
    const pRem = Math.max(0, Math.round(proteinTarget - eaten.p));
    const kRem = Math.max(0, Math.round(kcalTarget - eaten.kcal));

    this.innerHTML = `
      <section class="view" aria-labelledby="eat-title">
        <div class="section-head">
          <h2 id="eat-title">Today</h2>
          <span class="muted">${niceDay()}</span>
        </div>

        <div class="kpi-grid">
          <div class="kpi-tile">
            <span class="kpi-label">Protein</span>
            <span class="kpi">${Math.round(eaten.p)}<span class="kpi-unit">/${proteinTarget}g</span></span>
            <div class="progress"><div class="progress-fill" style="width:${pPct}%"></div></div>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Energy</span>
            <span class="kpi">${Math.round(eaten.kcal)}<span class="kpi-unit">/${kcalTarget}</span></span>
            <div class="progress"><div class="progress-fill" style="width:${kPct}%"></div></div>
          </div>
          <div class="kpi-tile">
            <span class="kpi-label">Remaining</span>
            <span class="kpi">${pRem}<span class="kpi-unit">g P</span></span>
            <span class="muted" style="font-size:var(--type-xs)">${kRem} kcal</span>
          </div>
        </div>

        <div class="section-head">
          <h2>Logged today</h2>
          <span class="muted">${logs.length} meal${logs.length === 1 ? '' : 's'}</span>
        </div>
        <div id="eat-logged" class="stack"></div>

        <div class="section-head" style="margin-top:var(--space-5)">
          <h2>${this._mode === 'suggest' ? 'What next' : 'Browse all'}</h2>
        </div>
        <div class="segmented" role="tablist">
          <button type="button" class="seg-btn ${this._mode === 'suggest' ? 'active' : ''}" data-mode="suggest">Suggested</button>
          <button type="button" class="seg-btn ${this._mode === 'browse' ? 'active' : ''}" data-mode="browse">Browse all</button>
        </div>
        <div id="eat-list"></div>
      </section>
    `;

    this.renderLogged(logs);
    if (this._mode === 'suggest') this.renderSuggested(pRem, kRem);
    else this.renderBrowse();

    this.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        this._mode = b.dataset.mode;
        this.render();
      });
    });
  }

  renderLogged(logs) {
    const host = this.querySelector('#eat-logged');
    if (!logs.length) {
      host.innerHTML = `<p class="muted" style="margin:0">Nothing logged yet. Pick something below and hit <strong>Log this meal</strong>.</p>`;
      return;
    }
    host.innerHTML = logs
      .sort((a, b) => (a.datetime < b.datetime ? -1 : 1))
      .map((l) => {
        const r = l.recipe_id ? getRecipe(l.recipe_id) : null;
        const name = r?.name || l.name || 'Meal';
        const time = l.datetime
          ? new Date(l.datetime).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        return `
        <article class="card" data-log-id="${l.id}">
          <div class="row" style="margin-bottom:var(--space-2)">
            <h3 style="margin:0">${escapeHtml(name)}</h3>
            <span class="muted">${time}</span>
          </div>
          <div class="cluster" style="margin-bottom:var(--space-3)">
            <span class="badge">${Math.round(l.kcal || 0)} kcal</span>
            <span class="badge">${Math.round(l.p || 0)}g P</span>
            <span class="badge">${Math.round(l.c || 0)}g C</span>
            <span class="badge">${Math.round(l.f || 0)}g F</span>
          </div>
          <button type="button" class="btn btn-ghost" data-act="remove" data-id="${l.id}">Remove</button>
        </article>
      `;
      })
      .join('');
    host.querySelectorAll('[data-act="remove"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteNutritionLog(btn.dataset.id);
      });
    });
  }

  renderSuggested(pRem, kRem) {
    const host = this.querySelector('#eat-list');
    const recipes = content.recipes || [];

    // Rank: prefer recipes whose macros fit what's left. Score is a
    // weighted distance from remaining, penalising overshoot more than
    // undershoot. A recipe that would blow past remaining kcal is pushed
    // to the bottom but not filtered out entirely.
    const scored = recipes
      .map((r) => {
        const m = r.macros_per_serving || {};
        const p = m.p || 0;
        const k = m.kcal || 0;
        // Prefer high protein when protein is the bottleneck.
        const pFit = pRem > 0 ? p / Math.max(pRem, 1) : 0; // 1.0 = exactly fits
        const kOver = k > kRem ? (k - kRem) / Math.max(kRem, 1) : 0;
        const score = pFit - kOver * 1.5;
        return { r, score, p, k };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    host.innerHTML = `
      <p class="muted" style="margin:0 0 var(--space-3)">
        ${
          pRem > 0 || kRem > 0
            ? `You've got <strong>${pRem}g protein</strong> and <strong>${kRem} kcal</strong> left. Top picks that fit:`
            : `You've hit your targets. Here are light options if you're still hungry:`
        }
      </p>
      <div class="stack">
        ${scored.map(({ r }) => recipeCard(r)).join('')}
      </div>
    `;
    this.wireCards(host);
  }

  renderBrowse() {
    const host = this.querySelector('#eat-list');
    const recipes = content.recipes || [];
    const cuisines = uniq(recipes.map((r) => r.cuisine)).sort();
    const methods = uniq(recipes.flatMap((r) => r.methods || [])).sort();
    const f = this._filters;
    const results = this.filteredRecipes();

    host.innerHTML = `
      <article class="card">
        <div class="field">
          <label class="label" for="recipe-q">Search</label>
          <input id="recipe-q" class="input" type="search" placeholder="Name or ingredient" value="${escapeHtml(f.query)}" />
        </div>
        <div class="filter-row" style="display:flex;flex-wrap:wrap;gap:var(--space-2)">
          ${selectChip('f-cat', 'Category', f.category, ['', 'breakfast', 'main', 'snack', 'side', 'drink'])}
          ${selectChip('f-cui', 'Cuisine', f.cuisine, ['', ...cuisines])}
          ${selectChip('f-met', 'Method', f.method, ['', ...methods])}
          ${selectChip('f-time', 'Time ≤', f.maxTime ? String(f.maxTime) : '', ['', '5', '15', '30', '60'], (v) => (v ? `${v} min` : 'Any'))}
          ${selectChip('f-phase', 'Phase', f.phase_fit, ['', 'cut', 'maintain', 'bulk'])}
          ${selectChip('f-prot', 'Protein tier', f.protein_tier, ['', 'main_40', 'breakfast_30', 'snack_15', 'high_protein'])}
          ${selectChip('f-cost', 'Cost', f.cost_tier, ['', '£', '££', '£££'])}
          ${selectChip('f-sort', 'Sort', f.sort, ['name', 'protein_desc', 'kcal_asc', 'time_asc', 'cost_asc'])}
          <button type="button" class="btn btn-ghost" data-act="clear">Clear</button>
        </div>
      </article>
      <div class="section-head"><h2>${results.length} of ${recipes.length}</h2></div>
      <div class="stack">
        ${results
          .slice(0, 120)
          .map((r) => recipeCard(r))
          .join('')}
      </div>
      ${results.length > 120 ? `<p class="muted" style="text-align:center;margin-top:var(--space-3)">Showing first 120. Narrow filters to see more.</p>` : ''}
    `;

    host.querySelector('#recipe-q').addEventListener('input', (e) => {
      this._filters.query = e.target.value;
      this.persistFilters();
      this.renderBrowse();
      this.querySelector('#recipe-q')?.focus();
    });
    const bindSel = (id, key, cast = (v) => v) => {
      const el = host.querySelector(`#${id}`);
      if (el)
        el.addEventListener('change', (e) => {
          this._filters[key] = cast(e.target.value);
          this.persistFilters();
          this.renderBrowse();
        });
    };
    bindSel('f-cat', 'category');
    bindSel('f-cui', 'cuisine');
    bindSel('f-met', 'method');
    bindSel('f-time', 'maxTime', (v) => (v ? Number(v) : 0));
    bindSel('f-phase', 'phase_fit');
    bindSel('f-prot', 'protein_tier');
    bindSel('f-cost', 'cost_tier');
    bindSel('f-sort', 'sort');
    host.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      this._filters = {
        query: '',
        category: '',
        cuisine: '',
        method: '',
        maxTime: 0,
        phase_fit: '',
        protein_tier: '',
        cost_tier: '',
        sort: 'name',
      };
      this.persistFilters();
      this.renderBrowse();
    });
    this.wireCards(host);
  }

  filteredRecipes() {
    const f = this._filters;
    const base = getRecipesFiltered({
      category: f.category || undefined,
      cuisine: f.cuisine || undefined,
      method: f.method || undefined,
      maxTimeMin: f.maxTime || undefined,
      phase_fit: f.phase_fit || undefined,
      query: f.query || undefined,
    });
    const filtered = base.filter((r) => {
      if (f.protein_tier && r.protein_tier !== f.protein_tier) return false;
      if (f.cost_tier && r.cost_tier !== f.cost_tier) return false;
      return true;
    });
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      protein_desc: (a, b) => (b.macros_per_serving?.p || 0) - (a.macros_per_serving?.p || 0),
      kcal_asc: (a, b) => (a.macros_per_serving?.kcal || 0) - (b.macros_per_serving?.kcal || 0),
      time_asc: (a, b) => (a.time_min || 0) - (b.time_min || 0),
      cost_asc: (a, b) => (a.cost_tier || '').length - (b.cost_tier || '').length,
    };
    return filtered.sort(sorters[f.sort] || sorters.name);
  }

  wireCards(host) {
    host.querySelectorAll('[data-recipe-id]').forEach((el) => {
      el.addEventListener('click', () => this.openRecipe(el.dataset.recipeId));
    });
  }

  openRecipe(id) {
    const el = document.createElement('jamie-recipe-detail');
    el.setAttribute('recipe-id', id);
    document.body.appendChild(el);
  }
}

function recipeCard(r) {
  const m = r.macros_per_serving || {};
  return `
    <article class="card card-link" data-recipe-id="${r.id}" role="button" tabindex="0">
      <div class="row" style="margin-bottom:var(--space-2)">
        <h3 style="margin:0">${escapeHtml(r.name)}</h3>
        <span class="muted">${r.time_min || 0} min</span>
      </div>
      <p class="muted" style="margin:0 0 var(--space-3)">${r.cuisine || ''}${r.cost_tier ? ` · ${r.cost_tier}` : ''}</p>
      <div class="cluster">
        <span class="badge">${m.kcal || 0} kcal</span>
        <span class="badge">${m.p || 0}g P</span>
        <span class="badge">${m.c || 0}g C</span>
        <span class="badge">${m.f || 0}g F</span>
      </div>
    </article>
  `;
}

function selectChip(id, label, value, options, fmt) {
  const opts = options
    .map((o) => {
      const text = fmt ? fmt(o) : o === '' ? `Any ${label.toLowerCase()}` : o;
      return `<option value="${o}" ${o === value ? 'selected' : ''}>${text}</option>`;
    })
    .join('');
  return `<label class="chip-select" style="display:flex;flex-direction:column;font-size:0.75rem">
    <span class="muted">${label}</span>
    <select id="${id}" class="input" style="padding:var(--space-1) var(--space-2);min-height:44px">${opts}</select>
  </label>`;
}

function niceDay() {
  const d = new Date();
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

customElements.define('jamie-eat', JamieEat);
