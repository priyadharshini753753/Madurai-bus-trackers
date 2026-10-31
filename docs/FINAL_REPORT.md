# Final report — Madurai District Bus Information & Journey Planning App

## Completed and tested
Verified by 137 automated checks: 20 API integration tests, 9 voice-parser tests, 25 + 83 browser (Chromium) E2E checks
run against the production build with the CSP enabled; no console/JS errors in any flow (blocked map tiles in the offline
sandbox excluded). `npm audit --omit=dev`: 0 vulnerabilities.

| # | Feature | Status |
|---|---|---|
| 1 | Existing app preserved (search, stop timeline, map, PWA) and upgraded; fake "LIVE" simulation removed | Done |
| 2 | Government / Private / Mini-bus data model and filters; operators, source, verification fields per route | Done |
| 3 | Smart route search: direct + one-transfer, operating days, boarding/destination/intermediate stops, fares when verified | Done |
| 4 | Schedule-based ETA with modular provider (GPS-ready), graceful missing data | Done |
| 5 | Offline timings: save/remove/refresh, last-sync time, outdated warning, auto-refresh on reconnect | Done |
| 6 | Women's Safety Mode: device-only contacts, trip share, SOS with confirmation, emergency numbers, optional location | Done (see limits) |
| 7 | Last-bus reminders with configurable lead time, permission explanation, unverified warnings | Done (foreground) |
| 8 | Tamil/Tanglish/English voice + text search, permission status, correction, fallback | Done (browser-dependent) |
| 9 | Admin: auth, roles, routes/stops/operators/sources, schedules, fares, verification, submissions review, stats, quality issues, audit log | Done |
| 10 | Service disruption alerts with validity, source, verification status, expiry | Done |
| 11 | Schema + CSV import/export + duplicate and conflict detection + verification history | Done |
| 12 | Responsive mobile-first UI, Tamil+English labels, loading/empty/error/offline states, status badges | Done |
| 13 | Testing and QA | Done |

## Needs your credentials / accounts
- **Postgres** (Neon or Supabase): `DATABASE_URL`.
- **`SESSION_SECRET`** and the first admin (`npm run admin:create`).
- Vercel project env vars. Rotate the Vercel token that was inside the originally uploaded `.env.local`.
- *Optional later:* a Web Push service (VAPID keys + a scheduler) if you want reminders delivered when the app is closed.

## Known limitations (honest list)
- **No real bus data is included.** The 6 routes/12 stops seeded by `db:seed-sample` are placeholders (flagged `sample`).
  Every real route, timing and fare must be entered/imported and verified. All Madurai-district routes are *not* assumed to exist in public datasets.
- Emergency numbers (112, 100, 181) are the national numbers; confirm locally. They are configured in `src/config/emergency.js`.
- The app cannot send SMS/call automatically; it prepares messages and opens the system share sheet / SMS / WhatsApp. Delivery is not confirmed.
- Reminders fire only while the app is open/installed (browser permitting). Closed-app push is not implemented.
- Voice recognition depends on the browser (best on Chrome/Android, needs internet; limited on iOS Safari). Typing always works.
- Search covers direct and **one-transfer** journeys; trips running past midnight and walking between nearby stops are not modelled.
- Route lines on the map join stops in order (not road geometry). Map tiles need internet.
- Rate limiting and lockout are database-backed (work on serverless) but basic; consider Vercel WAF/Firewall for production.
- Dev-server-only advisories may show in `npm audit` for Vite/esbuild (not shipped to production).
- Usage statistics are simple aggregate counters (searches, searches with no result) with no personal data.

## Data still needing verification
All of it. Priorities: TNSTC Madurai city/mofussil routes and their first/last timings, private bus routes by town,
mini-bus services by village, fares per stage, stop names (Tamil + common spellings), and official emergency contacts.
Use the admin dashboard Overview → "Data-quality issues" as the to-do list.
