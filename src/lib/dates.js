/*
 * Jamie PWA — date helpers
 *
 * House style: en-GB locale, DD/MM/YYYY display, 24h times.
 * Storage: UTC ISO strings for timestamps, local-date YYYY-MM-DD for
 * daily_log keys (so "today" means Jamie's local calendar day, not UTC).
 */

import { format, startOfWeek } from 'date-fns';

export function todayISO(now = new Date()) {
  // Local-date YYYY-MM-DD. NOT toISOString (that uses UTC and can roll
  // over at the wrong time near midnight).
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nowUTC() {
  return new Date().toISOString();
}

export function fmtDisplay(dateOrIso) {
  const d = typeof dateOrIso === 'string' ? parseYMD(dateOrIso) : dateOrIso;
  if (!d || Number.isNaN(d.getTime())) return '';
  return format(d, 'dd/MM/yyyy');
}

export function fmtTime24(dateOrIso) {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (!d || Number.isNaN(d.getTime())) return '';
  return format(d, 'HH:mm');
}

export function parseYMD(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function weekStart(date = new Date()) {
  // Monday-start weeks (en-GB convention).
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function greetingFor(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
