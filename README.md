# TaxOverchargeReclaimDesk

A reverse sales/use-tax recovery platform. It ingests already-paid vendor invoices, audits every taxed line against jurisdiction rate tables and the company's exemption-certificate registry, surfaces overcharges (wrong rates, taxed-despite-exemption, double-paid use tax), and drives each finding through a refund-claim workflow to recovered cash. Each claim carries a statute-of-limitations clock so refundable money is not lost to lapsed deadlines.

It is a self-serve alternative to contingency reverse-audit firms (who take 25-35% of recovered cash). The company keeps the recovery minus a flat SaaS fee.

See [docs/idea.md](docs/idea.md) for the full feature specification.

## Stack

- **Backend:** Hono (Node, TypeScript, ESM) running via `tsx`, with Drizzle ORM over a Neon Postgres database.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js app resolves the session server-side and proxies API calls to the backend with an injected `X-User-Id` header.
- **Package manager:** pnpm everywhere.

The repo is a two-package monorepo:

- `backend/` — the Hono API. All routes are mounted under `/api/v1`; a root `/health` returns `{ ok: true }`.
- `web/` — the Next.js frontend. Browser calls go to same-origin `/api/proxy/...` routes, which inject the authenticated user id before forwarding to the backend.

## Local Development

Prerequisites: Node 22+, pnpm, and a Postgres database (Neon recommended).

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL and FRONTEND_URL
pnpm dev               # node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default `3001` locally). The database schema must be provisioned out-of-band (Drizzle push or Neon console) before first boot; on startup the server only runs an idempotent seed of demo data.

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # next dev, http://localhost:3000
pnpm build                   # production build
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | Port to listen on (defaults to `3001` locally; Render sets `10000`). |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgres://user:password@host/db?sslmode=require`. |
| `FRONTEND_URL` | yes | Origin of the web app, used for CORS allow-listing (e.g. `http://localhost:3000`). |

### Frontend (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_AUTH_BASE_URL` | yes | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | yes | Random 32-byte hex secret for auth cookies (server-only). |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL the proxy forwards to (e.g. `http://localhost:3001` or the deployed Render URL). |

`NEXT_PUBLIC_API_URL` is the only variable exposed to the browser bundle; the browser itself always calls relative `/api/proxy/...` paths.

## Pricing

All features are free for signed-in users. Authentication exists to scope each workspace's invoices, vendors, rate tables, certificates, findings, and refund claims to its team. There is no paid tier or metered usage.

## Deployment

- **Backend:** Render web service (see `render.yaml`), runtime Node, build `cd backend && pnpm install`, start `cd backend && node --import tsx/esm src/index.ts`. Set `DATABASE_URL` and `FRONTEND_URL` as Render environment variables.
- **Frontend:** Vercel, framework Next.js, root directory `web`.
- **Local full stack:** `docker-compose up` brings the backend and web app up together.
