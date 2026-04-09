/*
 * Jamie PWA — hash router
 *
 * Hash-based because GitHub Pages subpath deploys play nicer with
 * hash routes than with History API + <base href>. All routes work
 * offline (the SW serves index.html, and the router picks up from there).
 *
 * Routes:
 *   #/today, #/train, #/eat, #/log, #/stats
 *   #/settings, #/onboarding
 */

import { loadSettings } from './lib/settings.js';

export const TABS = [
  { id: 'today', href: '#/today', label: 'Today', icon: 'home-outline' },
  { id: 'train', href: '#/train', label: 'Train', icon: 'barbell-outline' },
  { id: 'eat', href: '#/eat', label: 'Eat', icon: 'restaurant-outline' },
  { id: 'log', href: '#/log', label: 'Log', icon: 'clipboard-outline' },
  { id: 'stats', href: '#/stats', label: 'Stats', icon: 'stats-chart-outline' },
];

const ROUTES = {
  '/today': { tab: 'today', tag: 'jamie-today' },
  '/train': { tab: 'train', tag: 'jamie-train' },
  '/train/cardio': { tab: 'train', tag: 'jamie-train' },
  '/train/mobility': { tab: 'train', tag: 'jamie-train' },
  '/train/library': { tab: 'train', tag: 'jamie-exercise-library' },
  '/train/session/today': { tab: 'train', tag: 'jamie-train-session' },
  '/eat': { tab: 'eat', tag: 'jamie-eat' },
  '/log': { tab: 'log', tag: 'jamie-log' },
  '/stats': { tab: 'stats', tag: 'jamie-stats' },
  '/settings': { tab: null, tag: 'jamie-settings' },
  '/backup': { tab: null, tag: 'jamie-backup' },
  '/guides': { tab: null, tag: 'jamie-guides' },
  '/evidence': { tab: null, tag: 'jamie-evidence-library' },
  '/onboarding': { tab: null, tag: 'jamie-onboarding' },
};

export function currentPath() {
  const h = window.location.hash || '';
  const raw = h.startsWith('#') ? h.slice(1) : h;
  return raw || '/today';
}

export function resolveRoute() {
  const settings = loadSettings();
  const path = currentPath();
  if (!settings.onboarded && path !== '/onboarding') {
    return { path: '/onboarding', ...ROUTES['/onboarding'] };
  }
  // dynamic guide subpath: /guides/<key>
  if (path.startsWith('/guides/')) {
    const key = path.slice('/guides/'.length);
    return { path, tab: null, tag: 'jamie-guides', attrs: { 'guide-key': key } };
  }
  const entry = ROUTES[path];
  if (!entry) return { path: '/today', ...ROUTES['/today'] };
  return { path, ...entry };
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path : '#' + path;
}

export function onRouteChange(cb) {
  window.addEventListener('hashchange', cb);
  window.addEventListener('jamie:settings-changed', cb);
}
