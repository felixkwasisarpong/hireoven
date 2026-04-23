#!/usr/bin/env bash
set -euo pipefail

SUPABASE_DB_URL="${SUPABASE_DB_URL:-${1:-}}"
TARGET_POSTGRES_URL="${TARGET_POSTGRES_URL:-${2:-}}"

if [[ -z "${SUPABASE_DB_URL}" || -z "${TARGET_POSTGRES_URL}" ]]; then
  cat <<EOF
Usage:
  SUPABASE_DB_URL='postgres://...' TARGET_POSTGRES_URL='postgres://...' \\
  bash scripts/db/compare-public-counts.sh

Or:
  bash scripts/db/compare-public-counts.sh 'postgres://supabase-conn' 'postgres://target-conn'
EOF
  exit 1
fi

for cmd in psql; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}"
    exit 1
  fi
done

TABLES="$(psql "${SUPABASE_DB_URL}" -Atc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")"

if [[ -z "${TABLES}" ]]; then
  echo "No public tables found on source database."
  exit 1
fi

printf "%-40s %15s %15s %10s\n" "table" "source" "target" "status"
printf "%-40s %15s %15s %10s\n" "----------------------------------------" "---------------" "---------------" "----------"

while IFS= read -r table; do
  [[ -z "${table}" ]] && continue

  src_count="$(psql "${SUPABASE_DB_URL}" -Atc "SELECT COUNT(*) FROM public.\"${table}\";")"
  tgt_exists="$(psql "${TARGET_POSTGRES_URL}" -Atc "SELECT to_regclass('public.${table}') IS NOT NULL;")"

  if [[ "${tgt_exists}" != "t" ]]; then
    printf "%-40s %15s %15s %10s\n" "${table}" "${src_count}" "-" "MISSING"
    continue
  fi

  tgt_count="$(psql "${TARGET_POSTGRES_URL}" -Atc "SELECT COUNT(*) FROM public.\"${table}\";")"
  if [[ "${src_count}" == "${tgt_count}" ]]; then
    status="OK"
  else
    status="DIFF"
  fi

  printf "%-40s %15s %15s %10s\n" "${table}" "${src_count}" "${tgt_count}" "${status}"
done <<< "${TABLES}"

