# Zero-downtime deploys on Coolify

**Goal:** push a fix during the day, the site keeps serving, and a refresh after
the deploy picks up the new build. Today a deploy makes `hireoven.com` return
"no server found" for everyone.

Status: **plan — not yet applied.** Step 0 has shipped. Everything from step 1
changes production.

## What a deploy does today

Observed live on 2026-08-19 while a deploy ran:

```
23:33:32   postgres + minio containers RECREATED   hireoven.com -> 503
23:33:58   app container up 9s                     hireoven.com -> 200
```

Under a minute of hard downtime — but note the first line. **Your production
Postgres is destroyed and recreated on every app deploy.** New container, restart
count 0, old one gone. Every database connection in flight is severed. That is
almost certainly behind the `too many clients` and `read ETIMEDOUT` failures seen
against prod earlier the same day.

Shipping a front-end change should not bounce the database.

## Why Coolify cannot roll this

Coolify performs a rolling update — start the new container, wait for its health
check, then stop the old one — only when four conditions hold. Production
(app id 6, `hireoven:main-x120hh12gacgukae2vwb574y`) violates all four:

| Coolify requires | Production |
| --- | --- |
| Health check enabled and passing | `health_check_enabled = f`; container reports `NO HEALTHCHECK` |
| Default container naming | `container_name: hireoven-app` pinned in Compose |
| Not a Docker Compose deployment | `build_pack = dockercompose` |
| No host port mapping | `ports: "${APP_PORT:-3000}:3000"` published on `0.0.0.0` |

The Compose condition is decisive and cannot be configured away: Compose pins
container names, so old and new cannot coexist. Coolify stops, then starts. The
gap is the outage, and because app/postgres/minio are one stack, the whole stack
goes with it.

## Findings from the audit

**The app was on the public internet over plain HTTP.** The Compose mapping bound
`0.0.0.0`, so `http://5.161.53.248:3000/api/health` answered 200 with live job
counts, bypassing Traefik and TLS. Fixed in the repo (loopback binding); lands
with the next deploy.

**`/api/health` is the wrong probe.** Three queries, one a `COUNT(*)` over ~121k
companies, and a 500 whenever Postgres is unreachable. At Coolify's 5s interval
that is ~17k count queries a day against a Postgres on the same box, and a
DB-coupled probe lets a slow database pull a healthy app out of rotation. Step 0
adds `/api/health/live`, which touches nothing.

**Coolify injects every project env var into the web container — 141 of them.**
The Compose `app` service lists ~40. The rest are harvester-only
(`RESOLVE_COMPANY_DOMAINS_*`, `USAJOBS_*`, `THE_MUSE_API_KEY`, …). Notably
`CRON_SECRET` **is** present, even though the Compose file comments that it is
deliberately withheld from the public web runtime — that comment describes an
invariant Coolify does not honour. Not exploitable: `middleware.ts` rejects
`/api/cron/*` and `/api/crawl/*` on the web runtime with
409 `scheduler_not_available_on_web_runtime`, verified against the live site. It
is a hygiene problem, not a hole. Do not copy that env sprawl into the new app.

**Vestigial Caddy labels.** The container carries `caddy_0 = https://hireoven.com`
while the proxy is Traefik v3.6. Traefik routes via its own labels
(`traefik.enable=true`, `Host(\`hireoven.com\`)`) over the Docker network — which
is why removing the host port mapping is safe. Clear the Caddy labels eventually.

## Migration

Postgres and MinIO **do not move**. They are stateful and moving volumes is the
only genuinely dangerous part. Only the app leaves the Compose stack.

### Step 0 — liveness route (done)

`app/api/health/live/route.ts`. No DB, no object storage, no filesystem.

### Step 1 — new Coolify application, alongside the current one

| field | value |
| --- | --- |
| Build pack | **Dockerfile** (this is what unlocks rolling updates) |
| Dockerfile | `/Dockerfile` |
| Repository / branch | as today |
| Network | `x120hh12gacgukae2vwb574y` — so `postgres:5432` and `minio:9000` resolve |
| Container name | leave blank |
| Ports mapped to host | none |
| Ports exposed | `3000` |
| Domain | temporary, e.g. `next.hireoven.com` |

The image is already built by GitHub Actions, so the server keeps pulling rather
than building — no build load on the box.

**Environment.** Copy only what the `app` service in `docker-compose.prod.yml`
declares — that is the reviewed set. Load-bearing: `DATABASE_URL`, `MINIO_*`,
`AUTH_SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, the
`STRIPE_*` keys, `RESEND_API_KEY`. Deliberately omit `CRON_SECRET` and every
harvester-only variable. Do not hand-copy Coolify-generated ones
(`COOLIFY_*`, `SERVICE_*`, `SOURCE_COMMIT`) — Coolify recreates them.

### Step 2 — health check

| setting | value |
| --- | --- |
| Enabled | on |
| Path | `/api/health/live` |
| Port | `3000` |
| Interval | `10s` |
| Timeout | `5s` |
| Retries | `3` |
| Start period | `30s` |

The start period is the one people get wrong: Next.js needs time to boot, and too
short a value fails the first probe and rolls the deploy back.

### Step 3 — prove it before touching the real domain

On `next.hireoven.com`: sign in, load the dashboard feed, open a job page, upload
a résumé (the only flow that exercises MinIO).

Then deploy it a **second** time and watch:

```bash
watch -n1 'docker ps --format "{{.Names}} {{.Status}}" | grep app-'
# expect TWO app containers briefly — that is the rolling update

while true; do curl -s -o /dev/null -w "%{http_code} " https://next.hireoven.com; sleep 1; done
# expect an unbroken run of 200s
```

If you never see two containers, rolling updates are not active — recheck the
health check and that no host port is mapped.

### Step 4 — cut over

Move `hireoven.com` to the new application, then remove the `app` service from
`docker-compose.prod.yml` so the Compose stack is Postgres + MinIO only. This is
the one deliberate, short outage. From here, app deploys stop touching the
database.

### Rollback

Keep the old application in place, stopped, until several clean deploys have
passed. To revert: move the domain back and redeploy the Compose stack.

## After this

Deploys become: build in Actions → Coolify pulls → new container starts →
health check passes → traffic switches → old container stops. The site stays up
throughout, and a refresh afterwards serves the new build — which is the
behaviour originally asked for.

One caveat worth knowing: Next.js changes its build ID each deploy, so a tab left
open across a deploy can fail to fetch an old chunk on navigation. A refresh
fixes it. That is a client-cache artefact, not downtime.
