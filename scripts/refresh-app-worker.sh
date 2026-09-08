#!/usr/bin/env bash
# Keep the app-worker on the current :latest build.
#
# The app-worker is a Coolify *service*, so it PULLS ghcr.io/...:latest rather
# than building it. A merged PR and a green CI build do not deploy it, and
# neither a Coolify restart nor the leak watchdog does either — those re-run the
# image already on disk, so a container reading "Up 3 hours" can be serving a
# week-old build. Twice a merged auto-apply fix sat undeployed for days while
# the symptom looked like a code bug.
#
# Recreates ONLY when the image digest actually changed, so on a day with no new
# build this is a manifest check and nothing else. That matters because the
# app-worker serves every cron on this box; a needless restart would kill an
# in-flight crawl or enrichment pass.
#
# Run under the auto-apply lock so it can never recreate the container in the
# middle of an application run. Installed on the harvester box as:
#
#   50 5 * * * flock -n /tmp/hireoven-auto-apply.lock -c \
#     '/usr/local/bin/hireoven-refresh-worker.sh \
#      >>/var/log/hireoven/app-worker-refresh.log 2>&1'
#
# Daily rather than hourly on purpose: hourly would restart the worker mid-crawl
# whenever a build landed. The cost is that a merged fix can be up to a day late
# instead of indefinitely late.
set -uo pipefail

IMAGE=${APP_WORKER_IMAGE:-ghcr.io/felixkwasisarpong/hireoven:latest}
SVC=${APP_WORKER_SERVICE_DIR:-/data/coolify/services/ip98rroea0wqdddojgzumol0}
HEALTH_URL=${APP_WORKER_HEALTH_URL:-http://localhost:3001/api/health}

cd "$SVC" || { echo "[$(date -u +%FT%TZ)] service dir missing"; exit 0; }

before=$(docker image inspect "$IMAGE" --format "{{.Id}}" 2>/dev/null)
docker compose pull -q app-worker >/dev/null 2>&1
after=$(docker image inspect "$IMAGE" --format "{{.Id}}" 2>/dev/null)

if [ -z "$after" ]; then
  echo "[$(date -u +%FT%TZ)] pull failed, keeping the running image"
  exit 0
fi
if [ "$before" = "$after" ]; then
  exit 0
fi

built=$(docker image inspect "$IMAGE" --format "{{.Created}}" 2>/dev/null)
echo "[$(date -u +%FT%TZ)] new image (built $built) — recreating app-worker"
docker compose up -d --no-deps app-worker

# Do not hand control back until it answers, so the run that follows does not
# curl a container that is still booting.
for i in $(seq 1 90); do
  if curl -sf -o /dev/null --max-time 3 "$HEALTH_URL"; then
    echo "[$(date -u +%FT%TZ)] ready after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "[$(date -u +%FT%TZ)] WARNING: app-worker not ready after 90s"
