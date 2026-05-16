#!/bin/bash
# Hireoven scheduled tasks — register each block in Coolify → Scheduled Tasks.
# All tasks require CRON_SECRET and APP_URL to be set as env vars in Coolify.
#
# Usage (manual trigger): APP_URL=https://... CRON_SECRET=... bash scripts/crons.sh <name>
# Example: bash scripts/crons.sh ghost-scan

set -euo pipefail

APP_URL="${APP_URL:?APP_URL is required}"
CRON_SECRET="${CRON_SECRET:?CRON_SECRET is required}"

run() {
  local method="${2:-GET}"
  local path="$1"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running $path"
  curl -sf -X "$method" "$APP_URL/$path" \
    -H "Authorization: Bearer $CRON_SECRET"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done $path"
}

# ── Coolify Scheduled Tasks ────────────────────────────────────────────────────
#
# Name               Schedule          Command (paste into Coolify)
# ──────────────────────────────────────────────────────────────────────────────
# recent-jobs        0 * * * *         run api/alerts/recent-jobs?segment=with-resume
# crawl              0 * * * *         run api/crawl
# crawl-full         15 2 * * *        run api/crawl?sweep=all
# crawl-full-non-ats 45 2 * * *        run api/crawl?sweep=all&scope=non_ats
# crawl-enrichment   30 */2 * * *      run api/crawl/enrichment
# ghost-scan         0 */6 * * *       run api/cron/ghost-scan
# timing-refresh     0 */6 * * *       run api/cron/timing-refresh
# cohort-detect      0 */4 * * *       run api/cron/cohort-detect
# cohort-match       0 */12 * * *      run api/cron/cohort-match
# layoffs-fyi        0 1 * * *         run api/cron/layoffs-fyi
# health-scores      0 2 * * *         run api/cron/health-scores
# rejection-patterns 0 3 * * *         run api/cron/rejection-patterns
# burnout-classify   0 4 * * *         run api/cron/burnout-classify
# salary-digest      0 5 * * *         run api/cron/salary-digest
# warn-act           0 6 * * *         run api/cron/warn-act
# cohort-aggregate   0 7 * * *         run api/cron/cohort-aggregate
# deliver-checkins   0 9 * * *         run api/cron/deliver-checkins
# blog-generate      0 8 * * 1-5       run api/cron/blog-generate
# dice-ingest        0 */6 * * *       run api/cron/dice-ingest
# waas-ingest        15 */6 * * *      run api/cron/waas-ingest
# ──────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  recent-jobs)       run 'api/alerts/recent-jobs?segment=with-resume' ;;
  crawl)             run api/crawl ;;
  crawl-full)        run 'api/crawl?sweep=all' ;;
  crawl-full-non-ats) run 'api/crawl?sweep=all&scope=non_ats' ;;
  crawl-enrichment)  run api/crawl/enrichment ;;
  ghost-scan)        run api/cron/ghost-scan ;;
  timing-refresh)    run api/cron/timing-refresh ;;
  cohort-detect)     run api/cron/cohort-detect ;;
  cohort-match)      run api/cron/cohort-match ;;
  layoffs-fyi)       run api/cron/layoffs-fyi ;;
  health-scores)     run api/cron/health-scores ;;
  rejection-patterns) run api/cron/rejection-patterns ;;
  burnout-classify)  run api/cron/burnout-classify ;;
  salary-digest)     run api/cron/salary-digest ;;
  warn-act)          run api/cron/warn-act ;;
  cohort-aggregate)  run api/cron/cohort-aggregate ;;
  deliver-checkins)  run api/cron/deliver-checkins ;;
  blog-generate)     run api/cron/blog-generate ;;
  dice-ingest)       run api/cron/dice-ingest ;;
  waas-ingest)       run api/cron/waas-ingest ;;
  all)
    run 'api/alerts/recent-jobs?segment=with-resume'
    run api/crawl
    run api/crawl/enrichment
    run api/cron/ghost-scan
    run api/cron/timing-refresh
    run api/cron/cohort-detect
    run api/cron/cohort-match
    run api/cron/layoffs-fyi
    run api/cron/health-scores
    run api/cron/rejection-patterns
    run api/cron/burnout-classify
    run api/cron/salary-digest
    run api/cron/warn-act
    run api/cron/cohort-aggregate
    run api/cron/deliver-checkins
    run api/cron/blog-generate
    run api/cron/dice-ingest
    run api/cron/waas-ingest
    ;;
  *)
    echo "Usage: $0 <name|all>"
    echo ""
    echo "Available:"
    echo "  recent-jobs  crawl  crawl-full  crawl-full-non-ats  crawl-enrichment  ghost-scan  timing-refresh"
    echo "  cohort-detect  cohort-match  layoffs-fyi  health-scores"
    echo "  rejection-patterns  burnout-classify  salary-digest  warn-act"
    echo "  cohort-aggregate  deliver-checkins  blog-generate  dice-ingest"
    echo "  waas-ingest"
    exit 1
    ;;
esac
