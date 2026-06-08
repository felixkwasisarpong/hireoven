#!/usr/bin/env bash
#
# Main-box bring-up + data restore for a fresh server migration.
#
# Run this ON THE NEW MAIN BOX, from the repo root (where docker-compose.prod.yml
# lives) with a filled .env. It brings up Postgres + MinIO and restores your
# backups, then sanity-checks.
#
# Copy your backups onto the box first, then:
#   ESSENTIAL_DUMP=/root/hireoven-essential.dump \
#   JOBS_DUMP=/root/jobs.dump \          # optional (the 42 GB jobs table)
#   MINIO_TARBALL=/root/minio.tgz \      # optional (resume files)
#   bash scripts/restore-main-box.sh
#
# Required in .env: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, MINIO_* etc.
# Sizing note: defaults in docker-compose.prod.yml target a 16 GB box. For other
# sizes set POSTGRES_SHARED_BUFFERS / POSTGRES_EFFECTIVE_CACHE_SIZE in .env.

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
ESSENTIAL_DUMP="${ESSENTIAL_DUMP:-}"
JOBS_DUMP="${JOBS_DUMP:-}"
MINIO_TARBALL="${MINIO_TARBALL:-}"

[ -f .env ] || { echo "ERROR: .env not found in $(pwd)"; exit 1; }
set -a; . ./.env; set +a
PGUSER="${POSTGRES_USER:-hireoven}"
PGDB="${POSTGRES_DB:-hireoven}"

if [ -z "$ESSENTIAL_DUMP" ] || [ ! -f "$ESSENTIAL_DUMP" ]; then
  echo "ERROR: set ESSENTIAL_DUMP=/path/to/hireoven-essential-*.dump (file must exist)"; exit 1
fi

echo "==> 1/5  Starting Postgres + MinIO"
$COMPOSE up -d postgres minio minio-init

echo "==> 2/5  Waiting for Postgres to be healthy"
for i in $(seq 1 60); do
  if $COMPOSE exec -T postgres pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; then
    echo "    ready."; break
  fi
  sleep 3
  [ "$i" = 60 ] && { echo "ERROR: Postgres did not become ready"; exit 1; }
done

echo "==> 3/5  Restoring essential data (users, resumes meta, companies, etc.)"
echo "    (DROP ... does not exist warnings are normal on a fresh DB)"
$COMPOSE exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$PGUSER" -d "$PGDB" < "$ESSENTIAL_DUMP" || true

if [ -n "$JOBS_DUMP" ] && [ -f "$JOBS_DUMP" ]; then
  echo "==> 4/5  Restoring jobs table ($JOBS_DUMP)"
  $COMPOSE exec -T postgres pg_restore --no-owner --no-privileges \
    -U "$PGUSER" -d "$PGDB" < "$JOBS_DUMP" || true
else
  echo "==> 4/5  Skipping jobs table (no JOBS_DUMP) — the harvester will repopulate it."
fi

if [ -n "$MINIO_TARBALL" ] && [ -f "$MINIO_TARBALL" ]; then
  echo "==> 5/5  Restoring MinIO resume files into the volume"
  $COMPOSE stop minio >/dev/null 2>&1 || true
  VOL="$(docker volume ls --format '{{.Name}}' | grep -E 'minio_data$' | head -1)"
  [ -n "$VOL" ] || { echo "ERROR: could not find the minio_data volume"; exit 1; }
  docker run --rm -v "$VOL":/data -v "$(dirname "$MINIO_TARBALL")":/backup alpine \
    sh -c "cd /data && tar xzf /backup/$(basename "$MINIO_TARBALL")"
  $COMPOSE up -d minio
else
  echo "==> 5/5  Skipping MinIO restore (no MINIO_TARBALL)."
fi

echo "==> Verifying"
$COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -t -c \
  "SELECT 'auth.users='||count(*) FROM auth.users;
   SELECT 'profiles='||count(*) FROM profiles;
   SELECT 'resumes='||count(*) FROM resumes;
   SELECT 'companies='||count(*) FROM companies;
   SELECT 'jobs='||count(*) FROM jobs;
   SELECT 'shared_buffers='||current_setting('shared_buffers');"

cat <<'NEXT'

==> Done. Next:
  1. Bring up the public app:   docker compose -f docker-compose.prod.yml up -d app
  2. Point DNS (hireoven.com) at THIS box; confirm the site + login work.
  3. On the harvester box, set DATABASE_URL / MINIO_ENDPOINT to THIS box's IP and redeploy.
  4. Remove the temporary postgres port mapping (docker-compose.prod.yml) once clients connect over the private network, and decommission the old box.
NEXT
