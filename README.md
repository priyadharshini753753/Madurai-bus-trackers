# 🚌 Madurai Bus — district bus information & journey planner

React + Vite PWA with a Vercel-serverless API and Postgres. **No live GPS.** Everything is schedule-based and every
estimate is labelled as an estimate. **No real timetable data ships with this project**: only clearly-labelled
*sample* records for testing. Real data is added and verified through the admin dashboard / CSV import.

## What's inside
| Area | Where |
|---|---|
| Passenger app (search, results, route details, saved/offline, last-bus reminders, safety, alerts, about, feedback) | `src/pages`, `src/components`, `src/lib` |
| Admin dashboard (roles, routes/stops/operators/sources, alerts, submissions, CSV import/export, audit log, stats, data-quality) | `src/admin` |
| API (single Vercel function serving `/api/*`) | `api/[...path].js`, `server/` |
| Planner + ETA (shared by server and browser, pure functions) | `shared/planner.js`, `shared/eta.js`, `shared/time.js` |
| Database schema / migrations / sample seed | `db/migrations`, `scripts/` |
| Tests | `tests/` (API, voice parser, browser E2E) |

## Local setup
```bash
npm install
cp .env.example .env            # set DATABASE_URL and SESSION_SECRET (see below)
npm run db:migrate              # creates tables
npm run db:seed-sample          # OPTIONAL: labelled sample data (stops, 6 sample routes)
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password-12+' npm run admin:create
npm run dev                     # frontend + API on http://localhost:5173
```
Local Postgres example: `createdb madurai_bus` then
`DATABASE_URL=postgres://user:pass@127.0.0.1:5432/madurai_bus`.
`SESSION_SECRET`: `openssl rand -base64 48` (32+ chars required; the API refuses to start sessions without it).

## Deploy (Vercel + Neon, both have free tiers)
1. Create a Postgres database at **Neon** (or Supabase). Copy the *pooled* connection string.
2. Vercel → your project → Settings → Environment Variables: add `DATABASE_URL`, `SESSION_SECRET` (Production + Preview).
3. Run migrations once from your computer against that database:
   `DATABASE_URL='<neon url>' npm run db:migrate`
4. Create the first admin the same way: `DATABASE_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run admin:create`
5. Push to GitHub (Vercel deploys). `vercel.json` sets security headers (CSP, frame/MIME protections, HSTS).
6. Rotate any token that was ever shared in a zip/chat (e.g. the Vercel OIDC token in an old `.env.local`).
7. Don't run `db:seed-sample` in production unless you want demo data visible to passengers.

Housekeeping for the git repo: `git rm -r --cached madurai-bus-tracker/node_modules` (it had been committed).

## Adding real data (the important part)
Nothing is assumed to exist. Build the data incrementally and keep the source for every record:
1. **Admin → Sources**: add where information comes from (TNSTC notice, operator, field survey…) with a URL/notes.
2. **Admin → Stops**: add stops with Tamil names and *aliases* (spellings people say; used by voice search).
3. **Admin → Operators**: government / private / mini-bus operators.
4. **Admin → Routes** (or **Import / export** with CSV): ordered stops with minutes from the first stop,
   departure times + operating days, fares. Set status **Verified** only with a source and a verification date
   (the server enforces this). Anything else stays *Unverified*.
5. **Import / export**: always run the **dry run** first. Duplicates are skipped; a route that differs from the saved
   one is flagged as a **conflict** (an admin chooses to replace or keep, nothing is overwritten silently).
   CSV columns are in `server/importer.js` (download the template from the screen).
6. Passengers can suggest routes (About page). **Admin → Submissions** approve them into an *inactive, unverified draft*.
7. **Admin → Overview** lists data-quality issues: missing schedule, missing timings, no source, stale verification (>180 days).
8. Publish **service alerts** only from a real notice (source is mandatory); expired alerts are labelled / archived.

## Behaviour you can rely on
- Times shown are **scheduled** times; arrival/duration are **estimates** from stored stop-to-stop minutes.
  Missing data shows "Timing unavailable", "Duration unavailable" or "Fare not verified".
  The app never says a bus is running or approaching.
- ETA logic is behind a provider interface (`shared/eta.js`) so live GPS can be added later without touching the UI/planner.
- Search: direct routes + one-transfer journeys (minimum 5 minutes to change), government/private/mini-bus filters, operating-day aware.
- Offline: saved routes (full stops/schedule/fares/alerts) live in IndexedDB with last-sync time, auto-refresh when back online, outdated-data warnings.
- Last-bus reminders: computed from the schedule; in-app alert + system notification **while the app is open/installed and permission is granted**.
  True background push needs a push service (see report).
- Safety: trusted contacts stay **on the device only** (never sent to the server). Trip sharing uses the system share sheet,
  `sms:` or WhatsApp links, or copy; SOS needs a confirmation step, shows the 112 call button and a prepared message.
  The app **cannot** auto-send or auto-call and never claims it did. Location only with an explicit tick + browser permission.
- Voice: Web Speech API (`ta-IN` / `en-IN`) where supported, with visible mic-permission status, an editable transcript,
  ambiguous names (e.g. "Madurai") offered as choices, and full typed fallback (Tanglish / Tamil script / English).
- Admin: scrypt password hashes, signed HttpOnly SameSite cookies, role re-read from the database on **every** request,
  CSRF header requirement, account lockout, rate limits on public POSTs, server-side validation, audit log of changes.

## Tests
```bash
npm run test:unit                      # Tamil/Tanglish voice parser
npm run dev                            # in another terminal (API tests hit the dev server)
npm test                               # API integration tests (needs sample seed + 2 test users, see tests/api.test.mjs)
```
Browser E2E (Python Playwright, run against `npm run build && npm run preview --port 4180`):
`pip install playwright && playwright install chromium && python tests/e2e/public_flows.py`
