# Jamie PWA

Offline-first Progressive Web App for training, nutrition, and daily logging.
Single-user, local-only, installable to the Android home screen.

See:
- `../jamie_pwa_stack.md` — locked stack
- `../jamie_pwa_v1_spec.md` — v1 scope and data schema
- `../jamie_pwa_ux_spec.md` — wireframes, tokens, journeys
- `../CLAUDE.md` — house style

## Session 1 status

Shipped: shell, service worker, manifest, 5-tab bottom nav, onboarding,
Today view, Log view (daily_log schema), Settings view. Train, Eat, Stats
are routable placeholders until Session 2/3.

## Dev

```bash
npm install
npm run dev           # Vite dev server, no SW
npm run build         # Production bundle to dist/
npm run preview       # Serve dist/ locally (SW active)
npm run lint          # Biome check
npm run format        # Biome check --write
npm test              # Playwright smoke
npm run content       # tools/build-content.js (stub)
```

Dev mode has no service worker. To test offline behaviour, run
`npm run build && npm run preview` and throttle the network in DevTools.

## Install to home screen (local)

1. `npm run build && npm run preview`
2. Open the shown URL on the target device (same Wi-Fi).
3. Chrome will offer "Install app" once the manifest and SW are live.
   Service workers require HTTPS or `localhost`.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`:
build, lint, Playwright smoke, then publishes `dist/` to GitHub Pages.

## Data

- IndexedDB (`jamie` DB, v1): `daily_log`, `training_log`, `session_log`,
  `nutrition_log`, `cardio_log`, `reviews`.
- LocalStorage: `jamie.settings.v1` blob only.
- Storage is SI (kg, cm, km). Display layer converts to the user's
  preferred unit (default lb / in / mi).
- Dates stored as local-date `YYYY-MM-DD` for daily_log keys and UTC ISO
  for timestamps.

## Content pipeline

`tools/build-content.js` reads the docx/xlsx files in the parent
`Research/` folder and writes `src/content.json`. Currently a stub —
Session 2 wires it into the Train view.
