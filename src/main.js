/*
 * Jamie PWA — entry point
 *
 * Responsibilities:
 *   1. Pull in design tokens + base CSS
 *   2. Boot Ionic standalone components (initialize + register globally)
 *   3. Apply theme
 *   4. Request persistent storage (best-effort, on first launch)
 *   5. Mount the app shell
 *   6. Register the service worker via vite-plugin-pwa with an update flow
 */

import './styles/tokens.css';
import './styles/base.css';
import '@ionic/core/css/core.css';
import '@ionic/core/css/normalize.css';
import '@ionic/core/css/structure.css';
import '@ionic/core/css/typography.css';
import '@ionic/core/css/padding.css';

import { initialize, setAssetPath } from '@ionic/core/components';
// Per-component imports: each exports defineCustomElement which we call
// explicitly to register the element. This replaces @ionic/core/loader,
// whose lazy chunk URLs Vite can't resolve in production builds.
import { defineCustomElement as defineIonApp } from '@ionic/core/components/ion-app.js';
import { defineCustomElement as defineIonHeader } from '@ionic/core/components/ion-header.js';
import { defineCustomElement as defineIonToolbar } from '@ionic/core/components/ion-toolbar.js';
import { defineCustomElement as defineIonTitle } from '@ionic/core/components/ion-title.js';
import { defineCustomElement as defineIonButtons } from '@ionic/core/components/ion-buttons.js';
import { defineCustomElement as defineIonButton } from '@ionic/core/components/ion-button.js';
import { defineCustomElement as defineIonIcon } from 'ionicons/components/ion-icon.js';
import { setAssetPath as setIoniconAssetPath } from 'ionicons/components';
import { defineCustomElement as defineIonContent } from '@ionic/core/components/ion-content.js';
import { defineCustomElement as defineIonFooter } from '@ionic/core/components/ion-footer.js';
import { defineCustomElement as defineIonTabBar } from '@ionic/core/components/ion-tab-bar.js';
import { defineCustomElement as defineIonTabButton } from '@ionic/core/components/ion-tab-button.js';
import { defineCustomElement as defineIonLabel } from '@ionic/core/components/ion-label.js';
import { defineCustomElement as defineIonModal } from '@ionic/core/components/ion-modal.js';

function registerIonicComponents() {
  defineIonApp();
  defineIonHeader();
  defineIonToolbar();
  defineIonTitle();
  defineIonButtons();
  defineIonButton();
  defineIonIcon();
  defineIonContent();
  defineIonFooter();
  defineIonTabBar();
  defineIonTabButton();
  defineIonLabel();
  defineIonModal();
}

import { mountApp } from './app.js';
import { loadContent } from './lib/content.js';
import { requestPersistentStorage } from './lib/db.js';
import { initTheme } from './lib/theme.js';

// Console proxy: keeps the last 50 lines in memory for diagnostics export.
(function installConsoleProxy() {
  if (typeof window === 'undefined' || window.__jamieLogsInstalled) return;
  window.__jamieLogsInstalled = true;
  window.__jamieLogs = [];
  const push = (level, args) => {
    try {
      const line = `[${new Date().toISOString()}] ${level}: ${args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ')}`;
      window.__jamieLogs.push(line);
      if (window.__jamieLogs.length > 50) window.__jamieLogs.shift();
    } catch {
      /* ignore */
    }
  };
  ['log', 'info', 'warn', 'error'].forEach((lvl) => {
    const orig = console[lvl].bind(console);
    console[lvl] = (...args) => {
      push(lvl, args);
      orig(...args);
    };
  });
})();

function scheduleReminders() {
  import('./lib/settings.js').then(({ loadSettings }) => {
    const s = loadSettings();
    const r = s.reminders || {};
    const plan = [
      ['morning_log', 'Morning log', 'Log your weight and sleep.'],
      ['evening_log', 'Evening log', 'Log today so far.'],
      ['training', 'Training reminder', 'Session time.'],
    ];
    for (const [key, title, body] of plan) {
      if (!r[`${key}_on`] || !r[key]) continue;
      const [hh, mm] = r[key].split(':').map(Number);
      if (Number.isNaN(hh)) continue;
      const now = new Date();
      const fire = new Date();
      fire.setHours(hh, mm || 0, 0, 0);
      if (fire <= now) fire.setDate(fire.getDate() + 1);
      const delay = fire.getTime() - now.getTime();
      setTimeout(() => {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
          }
        } catch {
          /* ignore */
        }
      }, delay);
    }
  });
}

async function boot() {
  initialize();
  const assetBase = new URL(import.meta.env.BASE_URL, window.location.href).href;
  setAssetPath(assetBase);
  setIoniconAssetPath(assetBase);
  registerIonicComponents();
  initTheme();
  try {
    await loadContent();
  } catch (e) {
    console.error('[jamie] content load failed', e);
  }
  mountApp();
  requestPersistentStorage().catch(() => {});
  registerServiceWorker();
  scheduleReminders();
}

function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  // vite-plugin-pwa virtual module. Dynamic import so dev mode (no SW) works.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          // Session 1: minimal, non-blocking "update ready" prompt.
          if (confirm('Update ready. Reload now?')) updateSW(true);
        },
        onOfflineReady() {
          // eslint-disable-next-line no-console
          console.info('[jamie] offline ready');
        },
      });
    })
    .catch(() => {
      // vite dev has no SW registration; that is expected.
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
