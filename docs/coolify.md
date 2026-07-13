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
| `RESEND_API_KEY` / `MAIL_FROM_DOMAIN` | Email identities |
| `ANTHROPIC_API_KEY` | If you use AI routes in prod |
| `STRIPE_*` | If billing enabled |
| `CRON_SECRET`, `SUPABASE_WEBHOOK_SECRET` | As in example |
| Web Push `VAPID_*` | If push enabled |

7. Attach **domain** in Coolify → enable **HTTPS**.
8. **Deploy** / enable **auto deploy on push**.

### Scheduled tasks (crawl + alerts)

Vercel Cron is not used. In Coolify, add **scheduled tasks** (or any cron) that `GET` your public origin with `Authorization: Bearer <CRON_SECRET>` (same secret as in `.env.production.example`).

> **Production note:** on a small web box, point these at the private `app-worker`
> on the harvester box (`http://localhost:3100`) instead of the public origin, so
> the crawl/enrichment load never touches the user-facing box. See
> [Production two-box topology](#production-two-box-topology-offload-crons-off-the-web-box) below.

The production **Dockerfile** installs **`curl`** in the final image so scheduled task commands like the example below work. Redeploy after pulling this change; without `curl`, the job fails with `curl: not found`.

| Path | Suggested schedule | Purpose |
|------|--------------------|---------|
| `/api/crawl` | `*/30 * * * *` | Crawl active companies (rolling queue) |
| `/api/crawl?sweep=all` | `15 2 * * *` (optional) | Full sweep of active companies (heavier) |
| `/api/crawl?sweep=all&scope=non_ats` | `45 2 * * *` (recommended with harvester) | Full sweep of crawler-owned/non-ATS companies |
| `/api/cron/job-description-enrichment?batch=200&concurrency=4` | `*/15 * * * *` | Deterministically fills descriptions for pending crawler jobs so they can publish |
| `/api/alerts/digest` | `0 8 * * *` (UTC) | Daily digest emails |
| `/api/alerts/weekly` | `0 9 * * 1` (UTC) | Weekly digest emails |
| `/api/cron/refresh-title-suggestions` | `30 3 * * *` (UTC) | Rebuild title_suggestions lookup that backs the feed Job-title typeahead |

Example (replace host and secret):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://hireoven.com/api/crawl"
```

If the task fails with **`curl: not found`**, the container image was built **without** `curl` (older deploy). The repo’s **Dockerfile** installs `curl` in the final stage - **rebuild and redeploy** the app in Coolify so the new image is used.

**Workaround before redeploy** (Node is always in the image; set `APP_URL` to your public origin, no trailing slash):

```bash
node -e "const b=process.env.CRON_SECRET,u=(process.env.APP_URL||'').replace(/\/$/,'');if(!b||!u){console.error('Set CRON_SECRET and APP_URL');process.exit(1)}fetch(u+'/api/crawl',{headers:{Authorization:'Bearer '+b}}).then(r=>r.ok?r.text():Promise.reject(new Error('HTTP '+r.status))).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
```

In Coolify, add **`APP_URL`** (e.g. `https://hireoven.com`) and **`CRON_SECRET`** to the application’s environment so the scheduled task inherits them (or inline the URL and use a Coolify secret for the bearer token).

### Harvester worker

The production compose file includes a separate **`harvester`** service. This is required when `CRAWLER_SCOPE=non_ats`: the scheduled `/api/crawl` route handles non-ATS/company careers pages, while the harvester worker continuously claims ATS companies such as Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS, Oracle, and USAJobs.

GitHub Actions publishes two images on pushes to `main`:

- `ghcr.io/felixkwasisarpong/hireoven:latest` from `Dockerfile`
- `ghcr.io/felixkwasisarpong/hireoven-harvester:latest` from `Dockerfile.harvester`

Keep these production env vars set in Coolify for the compose application:

```bash
HARVESTER_USE_NEW_ADAPTERS=true
HARVESTER_INSTANCES=3
HARVESTER_TOTAL_CLAIM_BUDGET=36
HARVESTER_TICK_INTERVAL_MS=30000
USAJOBS_API_KEY=...
USAJOBS_USER_AGENT=...
```

Do not leave the harvester as a manually started `docker run` container long-term; it should be managed by the Coolify compose deployment so it is recreated with app deploys and receives the same production environment.

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

**`app-worker`** is the same app image, defined in [`../docker-compose.prod.yml`](../docker-compose.prod.yml)
under `profiles: ["worker"]`, bound to `127.0.0.1:${WORKER_PORT:-3100}` (never
public). The harvester box's crontab hits `http://localhost:3100/api/...` instead
of the public origin, so crawl/enrichment/ingest CPU+RAM stay on the 8 GB box.

Deploy (order matters — crons never stop, web box drained last):

1. **Harvester box** `.env`: point the worker at the web box's services, same as
   the harvester already does —
   `DATABASE_URL=postgres://…@<WEB_BOX_IP>:5432/…` and
   `MINIO_ENDPOINT=http://<WEB_BOX_IP>:9000`. (Optional `WORKER_PORT` if `3100`
   clashes with the harvester health port.)
2. Start the worker on the harvester box:
   `docker compose --profile worker up -d app-worker`
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
