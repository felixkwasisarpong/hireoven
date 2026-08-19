# Zero-downtime deploys on Coolify

Status: **plan — not yet applied to prod.** Step 0 (the liveness route) has shipped;
everything from step 1 changes production and needs a deliberate go-ahead.

## Why deploys currently take the site offline

Coolify performs a *rolling update* — start the new container, wait for it to pass
its health check, then stop the old one — only when four conditions hold. As of
2026-08-19, production violates all four.

| Coolify requires | Production (app id 6, `hireoven:main-x120hh12gacgukae2vwb574y`) |
| --- | --- |
| Health check enabled and passing | `health_check_enabled = f`; `docker inspect` reports `NO HEALTHCHECK` |
| Default container naming | `container_name: hireoven-app` hardcoded in `docker-compose.prod.yml` |
| Not a Docker Compose deployment | `build_pack = dockercompose`, `docker_compose_location = /docker-compose.prod.yml` |
| No host port mapping | `ports: "${APP_PORT:-3000}:3000"` → published on `0.0.0.0:3000` |

The Compose one is decisive: Compose pins container names, so Coolify cannot run
old and new side by side. It stops the old container and starts the new one, and
the gap — image pull, the `depends_on: postgres: service_healthy` wait, then
Next.js boot — is the outage.

Evidence that the app is unmonitored today: `docker ps` shows `(healthy)` beside
`postgres` and `minio`, and nothing beside the app.

## Two findings that outrank the downtime

### The app is on the public internet over plain HTTP

The Compose `ports:` mapping publishes on `0.0.0.0`, not loopback:

```
curl http://5.161.53.248:3000/api/health   →  200
```

That path bypasses Traefik and TLS entirely, and `/api/health` hands the caller
live job counts and the last crawl timestamp. Removing the mapping is required
for rolling updates anyway; it also closes this. If direct access is wanted for
debugging, bind it to `127.0.0.1:3000:3000` and reach it over an SSH tunnel.

### `/api/health` is the wrong probe

It issues three queries, one of them `COUNT(*) FROM companies WHERE is_active`
over ~121k rows, and returns 500 when Postgres is unreachable. At the configured
5-second interval that is ~17k count queries per day against a Postgres running
on the same box — and a probe that fails on DB trouble would make Traefik pull a
healthy app out of rotation, turning a slow database into a hard outage.

Step 0 adds `/api/health/live`, which touches nothing. Point the container probe
at that. Keep `/api/health` for status dashboards, where a DB-aware answer is
what you actually want.

## Migration

Postgres and MinIO stay exactly where they are. They are stateful, they do not
redeploy with the app, and moving volumes is the only genuinely dangerous part of
this. The app moves out of the Compose stack and becomes its own Coolify
application.

### Step 0 — liveness route (done)

`app/api/health/live/route.ts`. No database, no object storage, no filesystem.

### Step 1 — new Coolify application, alongside the current one

- Build pack: **Dockerfile** (not Compose) — this is what unlocks rolling updates
- Repository/branch as today; the image is already built by GitHub Actions, so
  the server keeps pulling rather than building
- Network: attach to `x120hh12gacgukae2vwb574y` so `postgres:5432` and
  `minio:9000` keep resolving exactly as they do inside the Compose stack
- Do **not** set a custom container name
- Do **not** map a host port — Traefik reaches the container on the internal
  network
- Copy every environment variable from the `app` service in
  `docker-compose.prod.yml`. `DATABASE_URL`, `MINIO_*`, `AUTH_SESSION_SECRET`,
  `NEXT_PUBLIC_APP_URL` and the Stripe keys are load-bearing; a missing one
  fails closed in ways that are not obvious. Note deliberately that `CRON_SECRET`
  is **not** passed to the web runtime — scheduled jobs run on the harvester box.
- Temporary domain (e.g. `next.hireoven.com`) so it can be exercised before it
  takes traffic

### Step 2 — health check

| setting | value |
| --- | --- |
| Enabled | on |
| Path | `/api/health/live` |
| Port | 3000 |
| Interval | 10s |
| Timeout | 5s |
| Retries | 3 |
| Start period | 30s |

The start period matters: Next.js needs time to boot, and too short a value makes
the first probe fail and the deploy roll back.

### Step 3 — verify before cutting over

On the temporary domain: sign in, load the dashboard feed, open a job page,
confirm résumé upload works (that exercises MinIO). Then deploy it a second time
and watch `docker ps` — you should see two app containers briefly, and
`curl https://hireoven.com` should never fail during it.

### Step 4 — cut over

Move the `hireoven.com` domain to the new application and remove the `app`
service from the Compose stack. This is the one step with a short, deliberate
outage. Keep the old stack definition until you have had a few clean deploys.

## Loose end

The app container carries Caddy labels (`caddy_0 = https://hireoven.com`) while
the running proxy is Traefik v3.6 — residue from a proxy switch. Harmless today
because Traefik routes by its own configuration, but worth clearing so the next
person does not debug against labels nothing reads.
