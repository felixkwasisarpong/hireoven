#!/bin/bash
# Hireoven scheduled tasks — register each block in Coolify → Scheduled Tasks.
# All tasks require CRON_SECRET and APP_URL to be set as env vars in Coolify.
#
# Usage (manual trigger): APP_URL=https://... CRON_SECRET=... bash scripts/crons.sh <name>
# Example: bash scripts/crons.sh ghost-scan

set -euo pipefail

APP_URL="${APP_URL:?APP_URL is required}"
APP_URL="${APP_URL%/}"
CRON_SECRET="${CRON_SECRET:?CRON_SECRET is required}"

run() {
  local method="${2:-GET}"
  local path="$1"
  local status=0
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running $path"
  # Opt-in hard cap on a single request. Without it a hung endpoint (e.g. a
  # wedged browser-enrichment batch) makes curl wait forever, and under a
  # `flock -n` cron that freezes every later run. Empty = no cap (long crawl/
  # ingest crons that legitimately run for many minutes set their own outer
  # `timeout`). Set CRON_MAX_TIME on per-cron lines that should self-bound.
  local maxtime=()
  [ -n "${CRON_MAX_TIME:-}" ] && maxtime=(--max-time "$CRON_MAX_TIME")
  curl -sf "${maxtime[@]}" -X "$method" "$APP_URL/$path" \
    -H "Authorization: Bearer $CRON_SECRET" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Failed $path (curl exit $status)" >&2
    return "$status"
  fi
  echo ""
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done $path"
}

run_many() {
  local group="$1"
  shift
  local failures=0
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running group $group ($# tasks)"
  for path in "$@"; do
    if ! run "$path"; then
      failures=$((failures + 1))
    fi
  done
  if [ "$failures" -gt 0 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Group $group completed with $failures failure(s)" >&2
    return 1
  fi
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done group $group"
}

# ── Coolify Scheduled Tasks ────────────────────────────────────────────────────
#
# Name               Schedule          Command (paste into Coolify)
# ──────────────────────────────────────────────────────────────────────────────
# instant-notify     */5 * * * *       run api/cron/instant-notify
# crawl              0 * * * *         run api/crawl
# crawl-full         15 2 * * *        run api/crawl?sweep=all
# crawl-full-non-ats 45 2 * * *        run api/crawl?sweep=all&scope=non_ats
# crawl-enrichment   manual only       run api/crawl/enrichment  # AI-backed; disabled by default
# job-description-enrichment */5 * * * * run api/cron/job-description-enrichment?batch=500&concurrency=12
# ghost-scan         0 */6 * * *       run api/cron/ghost-scan
# timing-refresh     0 */6 * * *       run api/cron/timing-refresh
# cohort-refresh     10 */6 * * *      run cohort detect -> match -> aggregate
# layoffs-fyi        0 1 * * *         run api/cron/layoffs-fyi
# health-scores      0 2 * * *         run api/cron/health-scores
# rejection-patterns 0 3 * * *         run api/cron/rejection-patterns
# burnout-classify   0 4 * * *         run api/cron/burnout-classify
# salary-digest      0 5 * * *         run api/cron/salary-digest
# warn-act           0 6 * * *         run api/cron/warn-act
# deliver-checkins   0 9 * * *         run api/cron/deliver-checkins
# nightly-maintenance 30 8 * * *       run pipeline-cleanup -> job-retention -> refresh-title-suggestions
# purge-dead-crawled-companies 45 8 * * * run api/cron/purge-dead-crawled-companies  # mark dead boards status='dead' so the harvester stops crawling them
# blog-generate      0 8 * * 1-5       run api/cron/blog-generate
# fresh-job-ingest   15 */6 * * *      run waas -> dice -> adzuna
# jsearch-ingest     45 5 * * *        run api/cron/jsearch-ingest
# aggregator-job-ingest 0 */12 * * *   run remotive -> themuse -> remoteok -> arbeitnow -> careerjet -> jooble
# discover-companies 0 5 * * *         run api/cron/discover-companies
# discover-tenants   0 */2 * * *       run api/cron/discover-tenants
# discover-from-domains 0 6 * * *      run api/cron/discover-from-domains  # requires DISCOVER_FROM_DOMAINS_ENABLED=true; stage 0 resolves name-only domains, stage 1 enrolls ATS
# ats-discovery-sweep 30 */4 * * *     run builtin-discovery -> careers-url-discovery
# glassdoor-discovery 30 5 * * *       run api/cron/glassdoor-discovery
# company-logos       40 6 * * *       run api/cron/company-logos  # logos for companies with a real/guessed domain but no logo
# signal-api-webhooks * * * * *        run api/cron/signal-api-webhooks
#
# NOTE: the two off-box discovery jobs (commoncrawl-mine, drain-workday) are NOT
# Coolify tasks — they run on the harvester box via Hetzner crontab. See
# scripts/hetzner-crontab-worker.example.
# ──────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  crawl)             run api/crawl ;;
  crawl-full)        run 'api/crawl?sweep=all' ;;
  crawl-full-non-ats) run 'api/crawl?sweep=all&scope=non_ats' ;;
  crawl-enrichment)  run api/crawl/enrichment ;;
  job-description-enrichment) run "api/cron/job-description-enrichment?batch=${JOB_DESCRIPTION_ENRICHMENT_BATCH:-100}&concurrency=${JOB_DESCRIPTION_ENRICHMENT_CONCURRENCY:-4}" ;;
  job-retention)     run "api/cron/job-retention?days=${JOB_RETENTION_DAYS:-30}&batch=${JOB_RETENTION_BATCH:-5000}&maxBatches=${JOB_RETENTION_MAX_BATCHES:-50}" ;;
  purge-dead-crawled-companies) run "api/cron/purge-dead-crawled-companies?minEmptyCrawls=${PURGE_DEAD_MIN_EMPTY_CRAWLS:-20}&mode=${PURGE_DEAD_MODE:-dead}&maxBatches=${PURGE_DEAD_MAX_BATCHES:-20}" ;;
  pipeline-cleanup)  run "api/cron/pipeline-cleanup?days=${PIPELINE_CLEANUP_DAYS:-7}" ;;
  refresh-title-suggestions) run api/cron/refresh-title-suggestions ;;
  instant-notify)    run api/cron/instant-notify ;;
  ghost-scan)        run api/cron/ghost-scan ;;
  timing-refresh)    run api/cron/timing-refresh ;;
  cohort-detect)     run api/cron/cohort-detect ;;
  cohort-match)      run api/cron/cohort-match ;;
  cohort-refresh)
    run_many "cohort-refresh" \
      api/cron/cohort-detect \
      api/cron/cohort-match \
      api/cron/cohort-aggregate
    ;;
  layoffs-fyi)       run api/cron/layoffs-fyi ;;
  health-scores)     run api/cron/health-scores ;;
  rejection-patterns) run api/cron/rejection-patterns ;;
  burnout-classify)  run api/cron/burnout-classify ;;
  salary-digest)     run api/cron/salary-digest ;;
  warn-act)          run api/cron/warn-act ;;
  cohort-aggregate)  run api/cron/cohort-aggregate ;;
  deliver-checkins)  run api/cron/deliver-checkins ;;
  blog-generate)     run api/cron/blog-generate ;;
  fresh-job-ingest)
    run_many "fresh-job-ingest" \
      api/cron/waas-ingest \
      api/cron/dice-ingest \
      api/cron/adzuna-ingest
    ;;
  dice-ingest)       run api/cron/dice-ingest ;;
  adzuna-ingest)     run api/cron/adzuna-ingest ;;
  jsearch-ingest)    run api/cron/jsearch-ingest ;;
  waas-ingest)       run api/cron/waas-ingest ;;
  aggregator-job-ingest)
    run_many "aggregator-job-ingest" \
      api/cron/remotive-ingest \
      api/cron/themuse-ingest \
      api/cron/remoteok-ingest \
      api/cron/arbeitnow-ingest \
      api/cron/careerjet-ingest \
      api/cron/jooble-ingest
    ;;
  remotive-ingest)   run api/cron/remotive-ingest ;;
  themuse-ingest)    run api/cron/themuse-ingest ;;
  remoteok-ingest)   run api/cron/remoteok-ingest ;;
  arbeitnow-ingest)  run api/cron/arbeitnow-ingest ;;
  careerjet-ingest)  run api/cron/careerjet-ingest ;;
  jooble-ingest)     run api/cron/jooble-ingest ;;
  discover-companies) run api/cron/discover-companies ;;
  discover-tenants)  run api/cron/discover-tenants ;;
  discover-ats-sweep) run "api/cron/discover-ats-sweep?batch=${DISCOVER_ATS_SWEEP_BATCH:-40}&concurrency=${DISCOVER_ATS_SWEEP_CONCURRENCY:-5}" ;;
  discover-from-domains) run "api/cron/discover-from-domains?batch=${DISCOVER_FROM_DOMAINS_BATCH:-100}&concurrency=${DISCOVER_FROM_DOMAINS_CONCURRENCY:-8}&resolveBatch=${DISCOVER_FROM_DOMAINS_RESOLVE_BATCH:-50}&resolveConcurrency=${DISCOVER_FROM_DOMAINS_RESOLVE_CONCURRENCY:-6}" ;;
  careers-url-discovery) run "api/cron/careers-url-discovery?batch=${CAREERS_DISCOVERY_BATCH:-10}" ;;
  ats-discovery-sweep)
    run_many "ats-discovery-sweep" \
      api/cron/builtin-discovery \
      "api/cron/careers-url-discovery?batch=${CAREERS_DISCOVERY_BATCH:-10}"
    ;;
  glassdoor-discovery) run api/cron/glassdoor-discovery ;;
  builtin-discovery) run api/cron/builtin-discovery ;;
  company-logos)     run "api/cron/company-logos?batch=${COMPANY_LOGOS_BATCH:-300}&concurrency=${COMPANY_LOGOS_CONCURRENCY:-6}" ;;
  signal-api-webhooks) run api/cron/signal-api-webhooks ;;
  career-crawl)      run "api/cron/career-crawl?mode=${CAREER_CRAWL_MODE:-crawl}&limit=${CAREER_CRAWL_LIMIT:-500}" ;;
  nightly-maintenance)
    run_many "nightly-maintenance" \
      "api/cron/pipeline-cleanup?days=${PIPELINE_CLEANUP_DAYS:-7}" \
      "api/cron/job-retention?days=${JOB_RETENTION_DAYS:-30}&batch=${JOB_RETENTION_BATCH:-5000}&maxBatches=${JOB_RETENTION_MAX_BATCHES:-50}" \
      api/cron/refresh-title-suggestions
    ;;
  all)
    run api/crawl
    run "api/cron/job-description-enrichment?batch=${JOB_DESCRIPTION_ENRICHMENT_BATCH:-100}&concurrency=${JOB_DESCRIPTION_ENRICHMENT_CONCURRENCY:-4}"
    run api/cron/instant-notify
    run api/cron/ghost-scan
    run api/cron/timing-refresh
    run_many "cohort-refresh" api/cron/cohort-detect api/cron/cohort-match api/cron/cohort-aggregate
    run api/cron/layoffs-fyi
    run api/cron/health-scores
    run api/cron/rejection-patterns
    run api/cron/burnout-classify
    run api/cron/salary-digest
    run api/cron/warn-act
    run api/cron/deliver-checkins
    run api/cron/blog-generate
    run_many "fresh-job-ingest" api/cron/waas-ingest api/cron/dice-ingest api/cron/adzuna-ingest
    run api/cron/jsearch-ingest
    run_many "aggregator-job-ingest" api/cron/remotive-ingest api/cron/themuse-ingest api/cron/remoteok-ingest api/cron/arbeitnow-ingest api/cron/careerjet-ingest api/cron/jooble-ingest
    run api/cron/discover-companies
    run api/cron/discover-tenants
    run "api/cron/discover-from-domains?batch=${DISCOVER_FROM_DOMAINS_BATCH:-100}&concurrency=${DISCOVER_FROM_DOMAINS_CONCURRENCY:-8}&resolveBatch=${DISCOVER_FROM_DOMAINS_RESOLVE_BATCH:-50}&resolveConcurrency=${DISCOVER_FROM_DOMAINS_RESOLVE_CONCURRENCY:-6}"
    run "api/cron/careers-url-discovery?batch=${CAREERS_DISCOVERY_BATCH:-10}"
    run api/cron/glassdoor-discovery
    run api/cron/signal-api-webhooks
    run_many "nightly-maintenance" "api/cron/pipeline-cleanup?days=${PIPELINE_CLEANUP_DAYS:-7}" "api/cron/job-retention?days=${JOB_RETENTION_DAYS:-30}&batch=${JOB_RETENTION_BATCH:-5000}&maxBatches=${JOB_RETENTION_MAX_BATCHES:-50}" api/cron/refresh-title-suggestions
    ;;
  *)
    echo "Usage: $0 <name|all>"
    echo ""
    echo "Available:"
    echo "  instant-notify  crawl  crawl-full  crawl-full-non-ats  crawl-enrichment  job-description-enrichment  ghost-scan  timing-refresh"
    echo "  cohort-detect  cohort-match  cohort-aggregate  cohort-refresh  layoffs-fyi  health-scores"
    echo "  rejection-patterns  burnout-classify  salary-digest  warn-act"
    echo "  deliver-checkins  blog-generate  pipeline-cleanup  job-retention  refresh-title-suggestions  nightly-maintenance"
    echo "  fresh-job-ingest  dice-ingest  adzuna-ingest  jsearch-ingest  waas-ingest"
    echo "  aggregator-job-ingest  remotive-ingest  themuse-ingest  remoteok-ingest  arbeitnow-ingest  careerjet-ingest  jooble-ingest"
    echo "  discover-companies  discover-tenants  discover-from-domains  careers-url-discovery  ats-discovery-sweep  glassdoor-discovery  signal-api-webhooks"
    echo "  career-crawl"
    exit 1
    ;;
esac
