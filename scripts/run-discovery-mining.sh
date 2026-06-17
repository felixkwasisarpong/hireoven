#!/bin/bash
# run-discovery-mining.sh — Common Crawl ATS board enumeration (path-based ATSes).
#
# Mines the free Common Crawl CDX index for ATS career boards that crt.sh
# STRUCTURALLY CANNOT SEE: path-based boards (Greenhouse, Lever, Ashby,
# Workable, SmartRecruiters, Rippling) live as a path under a shared vendor
# wildcard cert (e.g. boards.greenhouse.io/stripe), so they never appear in
# Certificate Transparency. Common Crawl is the only bulk source for them.
#
# The underlying script normalizes each indexed URL to its canonical board
# root, dedupes against companies + discovered_candidates, runs the confidence
# gate, and enrolls. The tiered harvester then picks the new boards up on its
# own — this only feeds the funnel, it does not harvest.
#
# Intentionally NOT an API route: one CDX query returns up to 200k rows/apex,
# which would exceed the 300s serverless budget and strain the web box. Run it
# as a standalone scheduled task (weekly is plenty — the CC index refreshes
# ~monthly).
#
# Usage:
#   bash scripts/run-discovery-mining.sh                  # DRY RUN (default; writes nothing)
#   EXECUTE=true bash scripts/run-discovery-mining.sh     # enroll for real
#   EXECUTE=true ATS=greenhouse,lever bash scripts/run-discovery-mining.sh
#   CC_INDEX=CC-MAIN-2026-21 EXECUTE=true bash scripts/run-discovery-mining.sh
#
# Env:
#   DATABASE_URL  required — the miner reads companies/discovered_candidates to dedup
#   EXECUTE       "true" to write to the DB; anything else = dry run (default)
#   ATS           optional CSV filter (greenhouse,lever,ashby,workable,smartrecruiters,rippling)
#   CC_INDEX      optional — override the Common Crawl index name (default baked into lib)

set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is required}"

ARGS=()
# Default to a dry run. Only write when EXECUTE=true (or --execute passed through).
if [[ "${EXECUTE:-}" == "true" || " $* " == *" --execute "* ]]; then
  ARGS+=(--execute)
fi
[[ -n "${ATS:-}" ]]      && ARGS+=("--ats=${ATS}")
[[ -n "${CC_INDEX:-}" ]] && ARGS+=("--index=${CC_INDEX}")

MODE="dry-run"
[[ " ${ARGS[*]:-} " == *" --execute "* ]] && MODE="EXECUTE"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] run-discovery-mining start — mode=${MODE} args=(${ARGS[*]:-none})"
npx tsx scripts/mine-commoncrawl-ats.ts "${ARGS[@]}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] run-discovery-mining done"
