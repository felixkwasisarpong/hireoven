#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${ROOT_DIR}/scripts/output/postgres-migration-${STAMP}"

SUPABASE_DB_URL="${SUPABASE_DB_URL:-${1:-}}"
TARGET_POSTGRES_URL="${TARGET_POSTGRES_URL:-${2:-}}"

if [[ -z "${SUPABASE_DB_URL}" || -z "${TARGET_POSTGRES_URL}" ]]; then
  cat <<EOF
Usage:
  SUPABASE_DB_URL='postgres://...' TARGET_POSTGRES_URL='postgres://...' \\
  ALLOW_TARGET_RESET=true bash scripts/db/migrate-supabase-to-postgres.sh

Or:
  ALLOW_TARGET_RESET=true bash scripts/db/migrate-supabase-to-postgres.sh \\
  'postgres://supabase-conn' 'postgres://target-conn'
EOF
  exit 1
fi

if [[ "${ALLOW_TARGET_RESET:-false}" != "true" ]]; then
  echo "Refusing to run without ALLOW_TARGET_RESET=true (restore uses --clean/--if-exists)."
  exit 1
fi

for cmd in pg_dump pg_restore psql; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}"
    exit 1
  fi
done

mkdir -p "${OUTPUT_DIR}"

DUMP_FILE="${OUTPUT_DIR}/public.dump"
SCHEMA_FILE="${OUTPUT_DIR}/public.schema.sql"
DATA_FILE="${OUTPUT_DIR}/public.data.sql"

echo "[1/6] Dumping public schema+data from Supabase..."
pg_dump "${SUPABASE_DB_URL}" \
  --schema=public \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${DUMP_FILE}"

echo "[2/6] Writing plain SQL artifacts for audit..."
pg_dump "${SUPABASE_DB_URL}" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file="${SCHEMA_FILE}"

pg_dump "${SUPABASE_DB_URL}" \
  --schema=public \
  --data-only \
  --inserts \
  --no-owner \
  --no-privileges \
  --file="${DATA_FILE}"

echo "[3/6] Bootstrapping auth schema on target Postgres..."
psql "${TARGET_POSTGRES_URL}" -v ON_ERROR_STOP=1 -f "${ROOT_DIR}/lib/postgres/auth-bootstrap.sql"

echo "[4/6] Restoring public schema+data into target Postgres..."
pg_restore "${DUMP_FILE}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="${TARGET_POSTGRES_URL}"

echo "[5/6] Seeding auth.users from profiles..."
psql "${TARGET_POSTGRES_URL}" -v ON_ERROR_STOP=1 -f "${ROOT_DIR}/lib/postgres/auth-seed-from-profiles.sql"

echo "[6/6] Migration dump+load complete."
echo "Artifacts:"
echo "  ${DUMP_FILE}"
echo "  ${SCHEMA_FILE}"
echo "  ${DATA_FILE}"
echo
echo "Next:"
echo "  SUPABASE_DB_URL='postgres://...' TARGET_POSTGRES_URL='postgres://...' \\"
echo "  bash scripts/db/compare-public-counts.sh"

