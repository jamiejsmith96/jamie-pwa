/*
 * Jamie PWA — app shell
 *
 * Wraps Ionic's <ion-app> + <ion-tabs> to provide the 5-tab bottom nav.
 * We render the active view into an <ion-content> rather than using
 * ion-router, because we use a hash router (simpler for Pages subpath
 * deploys) and we swap view custom elements ourselves.
 */

import { TABS, onRouteChange, resolveRoute } from './router.js';

// View registrations — importing for side effects only
import './views/evidence-modal.js';
import './views/exercise-library.js';
import './views/log.js';
import './views/onboarding.js';
import './views/placeholder.js';
import './views/settings.js';
import './views/today.js';
import './views/train.js';
import './views/train-session.js';

// Lazy-loaded views (Session C): kept out of the initial bundle.
const LAZY_TAGS = {
  'jamie-eat': () => import('./views/eat.js'),
  'jamie-stats': () => import('./views/stats.js'),
  'jamie-backup': () => import('./views/backup.js'),
  'jamie-guides': () => import('./views/guides.js'),
  'jamie-evidence-library': () => import('./views/evidence-library.js'),
};

const ROOT_SELECTOR = '#app-root';

function renderShell() {
  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) return;
  root.innerHTML = `
    <ion-app>
      <ion-header translucent="true">
        <ion-toolbar>
          <ion-title id="app-title">Jamie</ion-title>
          <ion-buttons slot="end">
            <ion-button id="nav-settings" aria-label="Settings">
              <ion-icon slot="icon-only" name="settings-outline"></ion-icon>
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>

      <ion-content id="view-host" fullscreen="true"></ion-content>

      <ion-footer>
        <ion-tab-bar id="tab-bar" selected-tab="today">
          ${TABS.map(
            (t) => `
            <ion-tab-button tab="${t.id}" href="${t.href}">
              <ion-icon name="${t.icon}" aria-hidden="true"></ion-icon>
              <ion-label>${t.label}</ion-label>
            </ion-tab-button>
          `,
          ).join('')}
        </ion-tab-bar>
      </ion-footer>
    </ion-app>
  `;

  document.getElementById('nav-settings').addEventListener('click', () => {
    const cur = window.location.hash || '#/';
    if (cur === '#/settings') {
      window.location.hash = window.__jamiePrevHash || '#/';
    } else {
      window.__jamiePrevHash = cur;
      window.location.hash = '#/settings';
    }
  });

  // ion-tab-button href only navigates inside ion-tabs+ion-router; we use
  // hash routing so wire clicks manually.
  document.getElementById('tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('ion-tab-button');
    if (!btn) return;
    const href = btn.getAttribute('href');
    if (href) {
      e.preventDefault();
      window.location.hash = href;
    }
  });
}

function renderCurrentRoute() {
  const host = document.getElementById('view-host');
  const title = document.getElementById('app-title');
  const tabBar = document.getElementById('tab-bar');
  if (!host) return;

  const route = resolveRoute();

  // swap view element
  host.innerHTML = '';
  const mount = () => {
    const el = document.createElement(route.tag);
    if (route.attrs) {
      for (const [k, v] of Object.entries(route.attrs)) el.setAttribute(k, v);
    }
    host.appendChild(el);
  };
  if (LAZY_TAGS[route.tag] && !customElements.get(route.tag)) {
    host.innerHTML = '<p class="muted" style="padding:var(--space-4)">Loading…</p>';
    LAZY_TAGS[route.tag]().then(() => {
      host.innerHTML = '';
      mount();
    });
  } else {
    mount();
  }

  // title
  const labels = {
    today: 'Today',
    train: 'Train',
    eat: 'Eat',
    log: 'Log',
    stats: 'Stats',
  };
  const titleMap = {
    '/settings': 'Settings',
    '/onboarding': 'Welcome',
  };
  if (title) title.textContent = titleMap[route.path] || labels[route.tab] || 'Jamie';

  // active tab indicator
  if (tabBar && route.tab) tabBar.setAttribute('selected-tab', route.tab);

  // hide tab bar during onboarding
  const footer = document.querySelector('ion-footer');
  if (footer) footer.style.display = route.path === '/onboarding' ? 'none' : '';
}

export function mountApp() {
  renderShell();
  renderCurrentRoute();
  onRouteChange(renderCurrentRoute);
}
