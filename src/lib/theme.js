/*
 * Jamie PWA — theme resolver
 *
 * Settings.theme is one of 'light' | 'dark' | 'system'.
 * - 'light' / 'dark'  → <html data-theme="...">
 * - 'system'          → remove data-theme, let prefers-color-scheme decide
 *
 * Also flips Ionic's global .ion-palette-dark class on <html> so Ionic's
 * own internal selectors adopt the correct palette.
 */

import { loadSettings } from './settings.js';

const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(settings = loadSettings()) {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  return media?.matches ? 'dark' : 'light';
}

export function applyTheme(settings = loadSettings()) {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') {
    root.setAttribute('data-theme', settings.theme);
  } else {
    root.removeAttribute('data-theme');
  }
  const resolved = resolveTheme(settings);
  root.classList.toggle('ion-palette-dark', resolved === 'dark');
  // meta theme-color tracks the actual background
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0a0a' : '#fafafa');
}

export function initTheme() {
  applyTheme();
  if (media) {
    media.addEventListener('change', () => applyTheme());
  }
  window.addEventListener('jamie:settings-changed', () => applyTheme());
}
