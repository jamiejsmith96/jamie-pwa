/*
 * Jamie PWA — haptics
 *
 * Thin wrapper over navigator.vibrate. Durations from ux_spec §10:
 * 20 ms primary tap, 40 ms on save, 200 ms on rest-timer done.
 * Silently no-ops on unsupported platforms (iOS Safari, desktop).
 */

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function vibrate(pattern) {
  if (!supported) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export const haptics = {
  tap: () => vibrate(20),
  save: () => vibrate(40),
  done: () => vibrate(200),
  pattern: (p) => vibrate(p),
};
