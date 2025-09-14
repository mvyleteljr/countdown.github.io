# Simple Notes

A minimal two-user notes app with attachments. Static frontend + a single Vercel Serverless Function backed by Postgres (Neon recommended).

## Deploy on Vercel

- Prereqs: Vercel account and CLI installed (`npm i -g vercel`), Postgres connection string (e.g., Neon).
- From the repo root:
  1) `vercel login`
  2) `vercel link` (or import in the Vercel dashboard)
  3) Add env vars:
     - `vercel env add DATABASE_URL` (paste your Postgres connection string)
     - `vercel env add API_SECRET` (optional; any strong token)
  4) Deploy preview: `vercel`
  5) Promote to prod: `vercel deploy --prod`

Vercel auto-detects `api/notes.mjs` as a Serverless Function and serves static files from the repo.

## Configuration

Edit `assets/config.js`:
- `apiBase`: leave empty (`""`) to call same-origin `/api/notes` (works locally and on Vercel).
- `apiSecret`: set only if you configured `API_SECRET` in Vercel; must match exactly.
- `autoRefreshMs`: UI auto-refresh interval in ms. `0` disables (default). Set to `5000` to poll every 5s.

## Environment Variables

- Database URL (required): set ONE of the following to your Postgres connection string (Vercel Postgres/Neon integration typically exposes these):
  - `DATABASE_URL`
  - `POSTGRES_URL`
  - `POSTGRES_URL_NON_POOLING` (preferred for serverless clients)
  - `POSTGRES_PRISMA_URL`
  - `DATABASE_URL_UNPOOLED`
  - `NEON_DATABASE_URL`
  - `PG_CONNECTION_STRING`
- `API_SECRET` (optional): enables write/delete protection. When set, client must send header `X-Token: <API_SECRET>`. The frontend will include it automatically if `assets/config.js` sets `apiSecret`.

## Local Development

- Pull envs: `vercel env pull .env.local` (or create `.env.local` with `DATABASE_URL` and optional `API_SECRET`).
- Run local: `vercel dev` (defaults to `http://localhost:3000`).
- Keep `apiBase: ""` for same-origin calls in dev.

## API

- `GET /api/notes` → `{ notes: [...] }` (public by default).
- `POST /api/notes` → `{ ok: true, note }` (requires `X-Token` if `API_SECRET` set). Body: `{ user, text, attachments: [{ name, type, size, dataUrl }] }`.
- `DELETE /api/notes?scope=today|all` → `{ ok: true }` (requires `X-Token` if `API_SECRET` set).

Notes are limited to one edit (two rows max) per user per day.

## Troubleshooting

- 500 missing database URL: set one of the supported DB env vars (above) in the correct environment (Production/Preview) and redeploy.
- Writes failing with 401: set matching `API_SECRET` (server) and `apiSecret` (client).
- Frontend flicker: `autoRefreshMs` is `0` by default. If enabling, the UI skips updates while editing and only re-renders on changes.

## Project Layout

- `index.html`, `log.html`, `reset.html`, `sign-in.html` — static pages.
- `assets/*` — frontend scripts and styles. Configure in `assets/config.js`.
- `api/notes.mjs` — Vercel Serverless Function (Node.js runtime) that talks to Postgres via Neon.
Triggering rebuild again
