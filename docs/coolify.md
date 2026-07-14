# Deploy Hireoven with Coolify

Hireoven is a **Next.js 14** app. Use a **Dockerfile** build on your Coolify server (recommended) or Coolify **Nixpacks** with `npm run build` / `npm run start`.

## Prerequisites

- **Supabase** project (URL + anon + service role keys).
- **Coolify** reachable at **HTTPS** so GitHub webhooks work (for private repo + auto deploy).
- Domain for the app (e.g. `hireoven.com`) with DNS pointing at the Coolify server.

## Option A - Dockerfile (recommended)

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
| `HIREOVEN_RUNTIME_ROLE` | `web` for the public app |
| `WEB_IMAGE_TAG` | Optional; pin to `sha-<commit>` for maintenance-window releases |
| `RESEND_API_KEY` / `MAIL_FROM_DOMAIN` | Email identities |
| `ANTHROPIC_API_KEY` | If you use AI routes in prod |
| `STRIPE_*` | If billing enabled |
| `SUPABASE_WEBHOOK_SECRET` | As in example |
| Web Push `VAPID_*` | If push enabled |

7. Attach **domain** in Coolify → enable **HTTPS**.
8. **Deploy**. For the public web app, keep **auto deploy on push disabled** so
   merging a PR cannot restart the user-facing box during the day.

### Deployment lanes

Image publication and container deployment are separate concerns:

- GitHub Actions builds/pushes images on `main`: `hireoven` and
  `hireoven-harvester`, each tagged `latest` and `sha-<commit>`.
- Coolify decides which running boxes restart. A pushed image does not restart a
  box unless that Coolify resource is configured to auto-deploy or you manually
  redeploy it.

Recommended production lanes:

| Lane | Coolify resource | Auto deploy | Image tag env | When it restarts |
|------|------------------|-------------|---------------|------------------|
| **Webbox** | `docker-compose.prod.yml` / public app | **Off** | `WEB_IMAGE_TAG=sha-<known-good>` or `latest` | Manual overnight maintenance only |
| **Harvester box** | `docker-compose.harvester.yml` | **On** | `WORKER_APP_IMAGE_TAG=latest`, `HARVESTER_IMAGE_TAG=latest` | On merge, or whenever you repair worker-side code |

With this setup, merging a PR can update the registry and restart the harvester
box, but it will not restart the webbox. To deploy the webbox, choose the exact
commit image you want, set `WEB_IMAGE_TAG=sha-<commit>` if you want a pinned
release, show the maintenance message, then manually redeploy the web resource.

### Scheduled tasks (worker box only)

Vercel Cron is not used. Do **not** add scheduled tasks to the public web app in
Coolify. Production scheduled work runs from the harvester box against the
private `app-worker` at `http://localhost:3100`, with
`Authorization: Bearer <CRON_SECRET>`.

The public web runtime is tagged `HIREOVEN_RUNTIME_ROLE=web`; scheduler routes
under `/api/cron`, `/api/crawl`, and cron-authenticated alert routes are blocked
there. The worker runtime is tagged `HIREOVEN_RUNTIME_ROLE=worker` and receives
`CRON_SECRET`.

| Path | Suggested schedule | Purpose |
|------|--------------------|---------|
| `/api/crawl` | `*/30 * * * *` | Crawl active companies (rolling queue) |
| `/api/crawl?sweep=all` | `15 2 * * *` (optional) | Full sweep of active companies (heavier) |
| `/api/crawl?sweep=all&scope=non_ats` | `45 2 * * *` (recommended with harvester) | Full sweep of crawler-owned/non-ATS companies |
| `/api/cron/job-description-enrichment?batch=200&concurrency=4` | `*/15 * * * *` | Deterministically fills descriptions for pending crawler jobs so they can publish |
| `/api/alerts/digest` | `0 8 * * *` (UTC) | Daily digest emails |
| `/api/alerts/weekly` | `0 9 * * 1` (UTC) | Weekly digest emails |
| `/api/cron/refresh-title-suggestions` | `30 3 * * *` (UTC) | Rebuild title_suggestions lookup that backs the feed Job-title typeahead |

Manual worker-box example:

```bash
APP_URL=http://localhost:3100 CRON_SECRET=... bash scripts/crons.sh crawl
```

`scripts/crons.sh` refuses non-local `APP_URL` values by default. Use
`ALLOW_NONLOCAL_CRON_URLS=true` only for a deliberate one-off manual run.

### Harvester worker

The worker-side compose file [`../docker-compose.harvester.yml`](../docker-compose.harvester.yml)
includes two private services:

- **`harvester`**: long-running ATS worker for Workday, Greenhouse, Lever, Ashby,
  SmartRecruiters, iCIMS, Oracle, USAJobs, Workable, and similar adapters.
- **`app-worker`**: the same Next.js app image as production, bound only to
  `127.0.0.1:${WORKER_PORT:-3100}` so host crons can call `/api/...` locally.

GitHub Actions publishes two images on pushes to `main`:

- `ghcr.io/felixkwasisarpong/hireoven:latest` from `Dockerfile`
- `ghcr.io/felixkwasisarpong/hireoven-harvester:latest` from `Dockerfile.harvester`

Keep these production env vars set in Coolify for the compose application:

```bash
HIREOVEN_RUNTIME_ROLE=worker
CRON_SECRET=...
WORKER_APP_IMAGE_TAG=latest
HARVESTER_IMAGE_TAG=latest
HARVESTER_USE_NEW_ADAPTERS=true
HARVESTER_INSTANCES=3
HARVESTER_TOTAL_CLAIM_BUDGET=36
HARVESTER_TICK_INTERVAL_MS=30000
USAJOBS_API_KEY=...
USAJOBS_USER_AGENT=...
```

Do not leave the harvester as a manually started `docker run` container
long-term. Manage the worker-side stack with `docker-compose.harvester.yml` so it
can be repaired or redeployed independently from the public web stack.

### Production two-box topology (offload crons off the web box)

`/api/crawl` and `/api/cron/job-description-enrichment` run their work **inside the
Next.js process**. On a small web box, the hourly 55-minute crawl (thousands of
HTTP + bulk writes) starves the app and co-located Postgres for RAM/CPU →
intermittent **502 Bad Gateway**. Fix: keep the web box user-facing only, and run
all batch crons on the bigger box that already runs the harvester.

| Box | Specs (example) | Runs |
|-----|-----------------|------|
| **Web** | CPX21 · 3 vCPU · 4 GB · us-east | Next.js app (public) + Postgres + MinIO. **No crons.** |
| **Harvester** | CPX31 · 4 vCPU · 8 GB · us-west | Harvester worker **+ `app-worker` (private)** + **all crons** |

**`app-worker`** is the same app image, defined in
[`../docker-compose.harvester.yml`](../docker-compose.harvester.yml), bound to
`127.0.0.1:${WORKER_PORT:-3100}` (never public). The harvester box's crontab hits
`http://localhost:3100/api/...` instead of the public origin, so
crawl/enrichment/ingest CPU+RAM stay on the 8 GB box.

Deploy (order matters — crons never stop, web box drained last):

1. **Harvester box** `.env`: point the worker at the web box's services, same as
   the harvester already does —
   `DATABASE_URL=postgres://…@<WEB_BOX_IP>:5432/…` and
   `MINIO_ENDPOINT=http://<WEB_BOX_IP>:9000`. (Optional `WORKER_PORT` if `3100`
   clashes with the harvester health port.)
2. Start the worker on the harvester box:
   `docker compose -f docker-compose.harvester.yml up -d app-worker harvester`
3. Verify: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/` and
   `APP_URL=http://localhost:3100 CRON_SECRET=… bash scripts/crons.sh ghost-scan`.
4. Install the worker crontab on the harvester box: `crontab -e`, paste
   [`../scripts/hetzner-crontab-worker.example`](../scripts/hetzner-crontab-worker.example)
   (fill `CRON_SECRET` + `DATABASE_URL`).
5. **Only then**, on the **web box**, `crontab -e` and delete all cron lines (see
   [`../scripts/hetzner-crontab.example`](../scripts/hetzner-crontab.example)).

> Postgres still lives on the web box and takes all write load. This split fixes
> the app-process contention (the 502s). If the DB itself becomes the next
> ceiling, move Postgres to the 8 GB box or a dedicated host.

### Healthcheck (optional)

- Path: `/` or `/api/health` if you add a small health route later.

## Option B - Nixpacks (no Dockerfile)

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm run start`
- **Node:** 20.x (`NIXPACKS_NODE_VERSION=20`)

Standalone Docker image is usually smaller and more predictable than Nixpacks for Next.

## Same server as other apps (e.g. Sepurux)

Coolify routes by **hostname**; each app gets its own container. Ensure **80/443** are owned by Coolify’s proxy only.

## GitHub Actions

This repo may have other CI; production deploy on Coolify is typically **Coolify + GitHub App webhooks**, not a separate SSH deploy unless you add it.
