/*
 * <jamie-backup> — export/import (v1 spec §10 risks, UX §6.17)
 *
 * Export: dumps every IDB store + settings + schema_version to a single JSON
 * file (showSaveFilePicker with anchor-download fallback).
 * Import: file picker → schema check → preview diff → confirm → merge write.
 * Stores last backup timestamp; banner if >14 days since last export.
 */

import { fmtDisplay, todayISO } from '../lib/dates.js';
import { exportAllStores, importAllStores, previewImport } from '../lib/db.js';
import { loadSettings, updateSettings } from '../lib/settings.js';

class JamieBackup extends HTMLElement {
  constructor() {
    super();
    this._diff = null;
    this._pending = null;
    this._msg = '';
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const s = loadSettings();
    const last = s.last_backup_at;
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    const overdue = days == null || days > 14;

    this.innerHTML = `
      <section class="view">
        <header class="hero">
          <p class="hero-eyebrow">Data</p>
          <h1 class="hero-title">Backup</h1>
          <p class="hero-sub">${last ? `Last backup: ${fmtDisplay(last.slice(0, 10))}` : 'No backup recorded yet.'}${overdue ? ' · Export recommended.' : ''}</p>
        </header>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)">
            <h3 style="margin:0">Export</h3>
            ${overdue ? '<span class="badge">Overdue</span>' : '<span class="badge tier-t1">OK</span>'}
          </div>
          <p class="muted">Downloads a single JSON containing every log, review, and your settings.</p>
          <button type="button" class="btn btn-hero btn-block" data-act="export">Export all data</button>
        </article>

        <article class="card">
          <div class="row" style="margin-bottom:var(--space-3)"><h3 style="margin:0">Import</h3></div>
          <p class="muted">Merge a previously exported backup. Existing rows with the same key are kept; new rows are added.</p>
          <input type="file" id="imp-file" accept="application/json,.json" class="input" />
          ${
            this._diff
              ? `<div class="stack" style="margin-top:var(--space-3)">
                  <p><strong>${this._diff.total_new}</strong> new rows, <strong>${this._diff.total_conflicts}</strong> conflicts (kept existing).</p>
                  <button type="button" class="btn btn-hero btn-block" data-act="confirm-import">Apply import</button>
                  <button type="button" class="btn btn-secondary btn-block" data-act="cancel-import">Cancel</button>
                </div>`
              : ''
          }
        </article>

        ${this._msg ? `<p class="muted" style="text-align:center">${this._msg}</p>` : ''}
        <button type="button" class="btn btn-ghost btn-block" data-act="back">Back to settings</button>
      </section>
    `;

    this.querySelector('[data-act="export"]').addEventListener('click', () => this.doExport());
    this.querySelector('#imp-file').addEventListener('change', (e) => this.onFile(e));
    this.querySelector('[data-act="confirm-import"]')?.addEventListener('click', () =>
      this.doImport(),
    );
    this.querySelector('[data-act="cancel-import"]')?.addEventListener('click', () => {
      this._diff = null;
      this._pending = null;
      this.render();
    });
    this.querySelector('[data-act="back"]').addEventListener('click', () => {
      window.location.hash = '#/settings';
    });
  }

  async doExport() {
    const data = await exportAllStores();
    const json = JSON.stringify(data, null, 2);
    const name = `jamie_backup_${todayISO()}.json`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        });
        const ws = await handle.createWritable();
        await ws.write(json);
        await ws.close();
      } catch {
        return;
      }
    } else {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    }
    updateSettings({ last_backup_at: new Date().toISOString() });
    this._msg = 'Export complete.';
    this.render();
  }

  async onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || !('schema_version' in obj)) {
        this._msg = 'Invalid backup file (missing schema_version).';
        this.render();
        return;
      }
      this._pending = obj;
      this._diff = await previewImport(obj);
      this._msg = '';
      this.render();
    } catch (err) {
      this._msg = 'Failed to parse backup: ' + err.message;
      this.render();
    }
  }

  async doImport() {
    if (!this._pending) return;
    await importAllStores(this._pending, 'merge');
    this._pending = null;
    this._diff = null;
    this._msg = 'Import complete.';
    this.render();
  }
}

customElements.define('jamie-backup', JamieBackup);
