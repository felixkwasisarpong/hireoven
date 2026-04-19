# Deploy Hireoven with Coolify

Hireoven is a **Next.js 14** app. Use a **Dockerfile** build on your Coolify server (recommended) or Coolify **Nixpacks** with `npm run build` / `npm run start`.

## Prerequisites

- **Supabase** project (URL + anon + service role keys).
- **Coolify** reachable at **HTTPS** so GitHub webhooks work (for private repo + auto deploy).
- Domain for the app (e.g. `hireoven.com`) with DNS pointing at the Coolify server.

## Option A — Dockerfile (recommended)

Repo includes [`../Dockerfile`](../Dockerfile) and Next [`output: "standalone"`](../next.config.js).

### In Coolify

1. **Project** → **+ New** → **Private Repository (with GitHub App)** (or deploy key).
2. Select **Hireoven** repo and branch (e.g. `main`).
3. Choose deployment via **Dockerfile** (wording: “Dockerfile” / “Build from Dockerfile”).
4. **Build context:** repository root (where `Dockerfile` lives).
5. **Port:** `3000`
6. **Environment variables:** copy from [`.env.production.example`](../.env.production.example) and set at least:

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; never expose to browser |
| `NEXT_PUBLIC_APP_URL` | Public site URL, e.g. `https://hireoven.com` |
| `NEXT_PUBLIC_SITE_URL` | Same as app URL if you use it for OG/links |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email (waitlist, alerts) |
| `ANTHROPIC_API_KEY` | If you use AI routes in prod |
| `STRIPE_*` | If billing enabled |
| `CRON_SECRET`, `SUPABASE_WEBHOOK_SECRET` | As in example |
| Web Push `VAPID_*` | If push enabled |

7. Attach **domain** in Coolify → enable **HTTPS**.
8. **Deploy** / enable **auto deploy on push**.

### Healthcheck (optional)

- Path: `/` or `/api/health` if you add a small health route later.

## Option B — Nixpacks (no Dockerfile)

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm run start`
- **Node:** 20.x (`NIXPACKS_NODE_VERSION=20`)

Standalone Docker image is usually smaller and more predictable than Nixpacks for Next.

## Same server as other apps (e.g. Sepurux)

Coolify routes by **hostname**; each app gets its own container. Ensure **80/443** are owned by Coolify’s proxy only.

## GitHub Actions

This repo may have other CI; production deploy on Coolify is typically **Coolify + GitHub App webhooks**, not a separate SSH deploy unless you add it.
