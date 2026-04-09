// Tiny .env loader — no dependency. Reads KEY=VALUE lines from
// jamie-pwa/.env (or the repo root as fallback) and merges them into
// process.env without overwriting existing variables.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '.env'),
];

export function loadEnv() {
  for (const path of CANDIDATES) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
    return path;
  }
  return null;
}
