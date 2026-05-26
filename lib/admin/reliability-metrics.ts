import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { FAST_SCORE_CACHE_EPOCH_ISO } from "@/lib/matching/score-freshness"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  buildSubscriptionSnapshot,
  evaluateSubscriptionSnapshotConsistency,
  type SubscriptionRowSnapshot,
} from "@/lib/subscription/snapshot"

type DuplicateRateRow = {
  total_titled_rows: string
  duplicate_rows: string
}

type NullTitleRateRow = {
  total_rows: string
  null_title_rows: string
}

type MatchScoreCoverageRow = {
  total_rows: string
  missing_match_score_rows: string
  sampled_users: string
  sampled_jobs: string
}

type WatchlistMismatchRow = {
  tracked_users: string
  mismatched_users: string
  raw_rows: string
  joined_rows: string
}

type LatestSubscriptionRow = SubscriptionRowSnapshot & {
  user_id: string
}

type ScraperArtifactCandidateRow = {
  title: string | null
  apply_url: string | null
}

type ReliabilityTrendWindowRow = {
  bucket: "current" | "previous"
  total_rows: string
  null_title_rows: string
  total_titled_rows: string
  duplicate_rows: string
}

type ReliabilityTrendArtifactCandidateRow = {
  bucket: "current" | "previous"
  title: string | null
  apply_url: string | null
}

const MATCH_SCORE_MISSING_ACTIVE_WINDOW_DAYS = 30
const MATCH_SCORE_MISSING_USER_SAMPLE_SIZE = 200
const MATCH_SCORE_MISSING_JOB_SAMPLE_SIZE = 50
const RELIABILITY_TREND_WINDOW_HOURS = 24

export type ReliabilityRateMetric = {
  numerator: number
  denominator: number
  ratePercent: number
}

export type ReliabilityRateTrend = {
  current: ReliabilityRateMetric
  previous: ReliabilityRateMetric
  deltaPercentPoints: number
}

export type AdminReliabilityMetrics = {
  computedAt: string
  duplicateRate: ReliabilityRateMetric & {
    duplicateRows: number
    totalTitledRows: number
  }
  nullTitleRate: ReliabilityRateMetric & {
    nullTitleRows: number
    totalRows: number
  }
  matchScoreMissingRate: ReliabilityRateMetric & {
    missingRows: number
    totalRows: number
    sampledUsers: number
    sampledJobs: number
  }
  watchlistMismatchRate: ReliabilityRateMetric & {
    mismatchedUsers: number
    trackedUsers: number
    rawRows: number
    joinedRows: number
  }
  scraperArtifactRate: ReliabilityRateMetric & {
    artifactRows: number
    totalRows: number
  }
  trends24h: {
    duplicateRate: ReliabilityRateTrend
    nullTitleRate: ReliabilityRateTrend
    scraperArtifactRate: ReliabilityRateTrend
  }
  subscriptionMismatchRate: ReliabilityRateMetric & {
    mismatchedSnapshots: number
    trackedSnapshots: number
  }
}

function asNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  return 0
}

export function toRateMetric(numerator: number, denominator: number): ReliabilityRateMetric {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return { numerator, denominator: Math.max(0, denominator || 0), ratePercent: 0 }
  }
  return {
    numerator,
    denominator,
    ratePercent: Number(((numerator / denominator) * 100).toFixed(2)),
  }
}

export function countSubscriptionSnapshotMismatches(rows: LatestSubscriptionRow[]): {
  mismatchedSnapshots: number
  trackedSnapshots: number
} {
  let mismatchedSnapshots = 0

  for (const row of rows) {
    const snapshot = buildSubscriptionSnapshot(row)
    const consistency = evaluateSubscriptionSnapshotConsistency(snapshot)
    if (!consistency.ok) mismatchedSnapshots += 1
  }

  return {
    mismatchedSnapshots,
    trackedSnapshots: rows.length,
  }
}

export function countScraperArtifactRows(rows: ScraperArtifactCandidateRow[]): number {
  return rows.reduce((count, row) => {
    const title = row.title ?? ""
    const applyUrl = row.apply_url ?? ""
    const flagged = isBlockedCrawlTitle(title) || isBlockedApplyUrl(applyUrl)
    return flagged ? count + 1 : count
  }, 0)
}

function buildRateTrend(args: {
  currentNumerator: number
  currentDenominator: number
  previousNumerator: number
  previousDenominator: number
}): ReliabilityRateTrend {
  const current = toRateMetric(args.currentNumerator, args.currentDenominator)
  const previous = toRateMetric(args.previousNumerator, args.previousDenominator)
  return {
    current,
    previous,
    deltaPercentPoints: Number((current.ratePercent - previous.ratePercent).toFixed(2)),
  }
}

export async function getAdminReliabilityMetrics(): Promise<AdminReliabilityMetrics> {
  const pool = getPostgresPool()

  const [duplicateResult, nullTitleResult, matchScoreCoverageResult, watchlistResult, scraperArtifactResult, reliabilityTrendResult, reliabilityTrendArtifactResult, latestSubscriptionResult] =
    await Promise.all([
      pool.query<DuplicateRateRow>(
        `WITH base AS (
           SELECT
             COALESCE(
               NULLIF(LOWER(BTRIM(j.company_id::text)), ''),
               NULLIF(LOWER(REGEXP_REPLACE(SPLIT_PART(REGEXP_REPLACE(COALESCE(j.apply_url, ''), '^https?://', ''), '/', 1), '^www\\.', '')), ''),
               'unknown'
             ) AS company_key,
             BTRIM(
               REGEXP_REPLACE(
                 LOWER(COALESCE(NULLIF(j.normalized_title, ''), NULLIF(j.title, ''), '')),
                 '[^a-z0-9]+',
                 ' ',
                 'g'
               )
             ) AS title_key,
             CASE
               WHEN COALESCE(j.is_remote, false) = true
                    OR LOWER(COALESCE(j.location, '')) ~ '(^|[^a-z0-9])remote([^a-z0-9]|$)'
                 THEN 'remote'
               ELSE BTRIM(
                 REGEXP_REPLACE(
                   LOWER(COALESCE(j.location, '')),
                   '[^a-z0-9]+',
                   ' ',
                   'g'
                 )
               )
             END AS location_key
           FROM jobs j
           WHERE j.is_active = true
             AND ${sqlJobLocatedInUsa("j")}
         ),
         titled AS (
           SELECT * FROM base WHERE title_key <> ''
         ),
         agg AS (
           SELECT
             COUNT(*)::bigint AS total_titled_rows,
             COUNT(DISTINCT (company_key || '|' || title_key || '|' || location_key))::bigint AS distinct_signatures
           FROM titled
         )
         SELECT
           total_titled_rows,
           GREATEST(total_titled_rows - distinct_signatures, 0)::bigint AS duplicate_rows
         FROM agg`
      ),
      pool.query<NullTitleRateRow>(
        `SELECT
           COUNT(*)::bigint AS total_rows,
           COUNT(*) FILTER (
             WHERE COALESCE(NULLIF(BTRIM(COALESCE(j.normalized_title, j.title, '')), ''), '') = ''
           )::bigint AS null_title_rows
         FROM jobs j
         WHERE j.is_active = true
           AND ${sqlJobLocatedInUsa("j")}`
      ),
      pool.query<MatchScoreCoverageRow>(
        `WITH active_users AS (
           SELECT
             p.id AS user_id,
             r.id AS resume_id,
             r.updated_at AS resume_updated_at
           FROM profiles p
           JOIN LATERAL (
             SELECT id, updated_at
             FROM resumes
             WHERE user_id = p.id
               AND is_primary = true
               AND parse_status = 'complete'
             ORDER BY updated_at DESC
             LIMIT 1
           ) r ON true
           WHERE p.updated_at >= NOW() - ($2::int * INTERVAL '1 day')
           ORDER BY p.updated_at DESC NULLS LAST
           LIMIT $3
         ),
         visible_jobs AS (
           SELECT j.id AS job_id
           FROM jobs j
           LEFT JOIN companies c ON c.id = j.company_id
           WHERE j.is_active = true
             AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
           ORDER BY j.first_detected_at DESC NULLS LAST
           LIMIT $4
         ),
         coverage_base AS (
           SELECT
             u.user_id,
             u.resume_updated_at,
             v.job_id
           FROM active_users u
           CROSS JOIN visible_jobs v
         ),
         latest_scores AS (
           SELECT DISTINCT ON (jms.user_id, jms.job_id)
             jms.user_id,
             jms.job_id,
             jms.computed_at
           FROM job_match_scores jms
           JOIN active_users u ON u.user_id = jms.user_id
           JOIN visible_jobs v ON v.job_id = jms.job_id
           ORDER BY jms.user_id, jms.job_id, jms.computed_at DESC
         )
         SELECT
           COUNT(*)::bigint AS total_rows,
           COUNT(*) FILTER (
             WHERE ls.user_id IS NULL
               OR ls.computed_at < GREATEST(cb.resume_updated_at, $1::timestamptz)
           )::bigint AS missing_match_score_rows,
           COALESCE((SELECT COUNT(*) FROM active_users), 0)::bigint AS sampled_users,
           COALESCE((SELECT COUNT(*) FROM visible_jobs), 0)::bigint AS sampled_jobs
         FROM coverage_base cb
         LEFT JOIN latest_scores ls
           ON ls.user_id = cb.user_id
          AND ls.job_id = cb.job_id`,
        [
          FAST_SCORE_CACHE_EPOCH_ISO,
          MATCH_SCORE_MISSING_ACTIVE_WINDOW_DAYS,
          MATCH_SCORE_MISSING_USER_SAMPLE_SIZE,
          MATCH_SCORE_MISSING_JOB_SAMPLE_SIZE,
        ]
      ),
      pool.query<WatchlistMismatchRow>(
        `WITH raw AS (
           SELECT user_id, COUNT(*)::bigint AS raw_count
           FROM watchlist
           GROUP BY user_id
         ),
         joined AS (
           SELECT w.user_id, COUNT(*)::bigint AS joined_count
           FROM watchlist w
           JOIN companies c ON c.id = w.company_id
           GROUP BY w.user_id
         ),
         combined AS (
           SELECT
             COALESCE(raw.user_id, joined.user_id) AS user_id,
             COALESCE(raw.raw_count, 0)::bigint AS raw_count,
             COALESCE(joined.joined_count, 0)::bigint AS joined_count
           FROM raw
           FULL OUTER JOIN joined USING (user_id)
         )
         SELECT
           COUNT(*)::bigint AS tracked_users,
           COUNT(*) FILTER (WHERE raw_count <> joined_count)::bigint AS mismatched_users,
           COALESCE(SUM(raw_count), 0)::bigint AS raw_rows,
           COALESCE(SUM(joined_count), 0)::bigint AS joined_rows
         FROM combined`
      ),
      pool.query<ScraperArtifactCandidateRow>(
        `SELECT
           COALESCE(NULLIF(j.normalized_title, ''), j.title) AS title,
           j.apply_url
         FROM jobs j
         WHERE j.is_active = true
           AND ${sqlJobLocatedInUsa("j")}
           AND (
             COALESCE(NULLIF(BTRIM(COALESCE(j.normalized_title, j.title, '')), ''), '') = ''
             OR LENGTH(BTRIM(COALESCE(j.normalized_title, j.title, ''))) < 3
             OR LOWER(COALESCE(j.normalized_title, j.title, '')) ~ '(login|page [0-9]+|search jobs|go to|view all jobs|unknown role|no jobs found|explore jobs|contractor roles|remote opportunities|hybrid opportunities)'
             OR LOWER(COALESCE(j.apply_url, '')) ~ '(linkedin\\.com/jobs/[^/]+-jobs|/jobs/login$|/jobs/intro$|/intro$|loginonly=1)'
           )`
      ),
      pool.query<ReliabilityTrendWindowRow>(
        `WITH scoped AS (
           SELECT
             CASE
               WHEN j.first_detected_at >= NOW() - ($1::int * INTERVAL '1 hour') THEN 'current'
               WHEN j.first_detected_at >= NOW() - (($1::int * 2) * INTERVAL '1 hour')
                 THEN 'previous'
               ELSE NULL
             END AS bucket,
             COALESCE(NULLIF(j.normalized_title, ''), j.title) AS merged_title,
             COALESCE(
               NULLIF(LOWER(BTRIM(j.company_id::text)), ''),
               NULLIF(LOWER(REGEXP_REPLACE(SPLIT_PART(REGEXP_REPLACE(COALESCE(j.apply_url, ''), '^https?://', ''), '/', 1), '^www\\.', '')), ''),
               'unknown'
             ) AS company_key,
             BTRIM(
               REGEXP_REPLACE(
                 LOWER(COALESCE(NULLIF(j.normalized_title, ''), NULLIF(j.title, ''), '')),
                 '[^a-z0-9]+',
                 ' ',
                 'g'
               )
             ) AS title_key,
             CASE
               WHEN COALESCE(j.is_remote, false) = true
                    OR LOWER(COALESCE(j.location, '')) ~ '(^|[^a-z0-9])remote([^a-z0-9]|$)'
                 THEN 'remote'
               ELSE BTRIM(
                 REGEXP_REPLACE(
                   LOWER(COALESCE(j.location, '')),
                   '[^a-z0-9]+',
                   ' ',
                   'g'
                 )
               )
             END AS location_key
           FROM jobs j
           LEFT JOIN companies c ON c.id = j.company_id
           WHERE j.is_active = true
             AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
             AND j.first_detected_at >= NOW() - (($1::int * 2) * INTERVAL '1 hour')
         ),
         windowed AS (
           SELECT * FROM scoped WHERE bucket IS NOT NULL
         ),
         quality AS (
           SELECT
             bucket,
             COUNT(*)::bigint AS total_rows,
             COUNT(*) FILTER (
               WHERE COALESCE(NULLIF(BTRIM(COALESCE(merged_title, '')), ''), '') = ''
             )::bigint AS null_title_rows
           FROM windowed
           GROUP BY bucket
         ),
         duplicate_agg AS (
           SELECT
             bucket,
             COUNT(*) FILTER (WHERE title_key <> '')::bigint AS total_titled_rows,
             GREATEST(
               COUNT(*) FILTER (WHERE title_key <> '')::bigint
               - COUNT(DISTINCT CASE WHEN title_key <> '' THEN (company_key || '|' || title_key || '|' || location_key) END)::bigint,
               0
             )::bigint AS duplicate_rows
           FROM windowed
           GROUP BY bucket
         )
         SELECT
           q.bucket::text AS bucket,
           q.total_rows,
           q.null_title_rows,
           COALESCE(d.total_titled_rows, 0)::bigint AS total_titled_rows,
           COALESCE(d.duplicate_rows, 0)::bigint AS duplicate_rows
         FROM quality q
         LEFT JOIN duplicate_agg d ON d.bucket = q.bucket`,
        [RELIABILITY_TREND_WINDOW_HOURS]
      ),
      pool.query<ReliabilityTrendArtifactCandidateRow>(
        `WITH scoped AS (
           SELECT
             CASE
               WHEN j.first_detected_at >= NOW() - ($1::int * INTERVAL '1 hour') THEN 'current'
               WHEN j.first_detected_at >= NOW() - (($1::int * 2) * INTERVAL '1 hour')
                 THEN 'previous'
               ELSE NULL
             END AS bucket,
             COALESCE(NULLIF(j.normalized_title, ''), j.title) AS title,
             j.apply_url
           FROM jobs j
           LEFT JOIN companies c ON c.id = j.company_id
           WHERE j.is_active = true
             AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
             AND j.first_detected_at >= NOW() - (($1::int * 2) * INTERVAL '1 hour')
         )
         SELECT bucket::text AS bucket, title, apply_url
         FROM scoped
         WHERE bucket IS NOT NULL`,
        [RELIABILITY_TREND_WINDOW_HOURS]
      ),
      pool.query<LatestSubscriptionRow>(
        `WITH ranked AS (
           SELECT
             user_id,
             plan,
             status,
             current_period_end,
             billing_interval,
             amount_cents,
             cancel_at_period_end,
             trial_end,
             ROW_NUMBER() OVER (
               PARTITION BY user_id
               ORDER BY updated_at DESC NULLS LAST, created_at DESC
             ) AS rn
           FROM subscriptions
         )
         SELECT
           user_id,
           plan,
           status,
           current_period_end,
           billing_interval,
           amount_cents,
           cancel_at_period_end,
           trial_end
         FROM ranked
         WHERE rn = 1`
      ),
    ])

  const duplicateRow = duplicateResult.rows[0]
  const totalTitledRows = asNumber(duplicateRow?.total_titled_rows)
  const duplicateRows = asNumber(duplicateRow?.duplicate_rows)

  const nullTitleRow = nullTitleResult.rows[0]
  const totalRows = asNumber(nullTitleRow?.total_rows)
  const nullTitleRows = asNumber(nullTitleRow?.null_title_rows)

  const matchScoreCoverageRow = matchScoreCoverageResult.rows[0]
  const matchScoreCoverageTotalRows = asNumber(matchScoreCoverageRow?.total_rows)
  const missingMatchScoreRows = asNumber(matchScoreCoverageRow?.missing_match_score_rows)
  const sampledUsers = asNumber(matchScoreCoverageRow?.sampled_users)
  const sampledJobs = asNumber(matchScoreCoverageRow?.sampled_jobs)

  const watchlistRow = watchlistResult.rows[0]
  const trackedUsers = asNumber(watchlistRow?.tracked_users)
  const mismatchedUsers = asNumber(watchlistRow?.mismatched_users)
  const rawRows = asNumber(watchlistRow?.raw_rows)
  const joinedRows = asNumber(watchlistRow?.joined_rows)

  const artifactRows = countScraperArtifactRows(scraperArtifactResult.rows)

  const trendByBucket = new Map(
    reliabilityTrendResult.rows.map((row) => [row.bucket, row] as const)
  )
  const trendCurrent = trendByBucket.get("current")
  const trendPrevious = trendByBucket.get("previous")
  const trendCurrentTotalRows = asNumber(trendCurrent?.total_rows)
  const trendPreviousTotalRows = asNumber(trendPrevious?.total_rows)
  const trendCurrentNullTitleRows = asNumber(trendCurrent?.null_title_rows)
  const trendPreviousNullTitleRows = asNumber(trendPrevious?.null_title_rows)
  const trendCurrentTotalTitledRows = asNumber(trendCurrent?.total_titled_rows)
  const trendPreviousTotalTitledRows = asNumber(trendPrevious?.total_titled_rows)
  const trendCurrentDuplicateRows = asNumber(trendCurrent?.duplicate_rows)
  const trendPreviousDuplicateRows = asNumber(trendPrevious?.duplicate_rows)

  const trendCurrentArtifactRows = countScraperArtifactRows(
    reliabilityTrendArtifactResult.rows.filter((row) => row.bucket === "current")
  )
  const trendPreviousArtifactRows = countScraperArtifactRows(
    reliabilityTrendArtifactResult.rows.filter((row) => row.bucket === "previous")
  )

  const subscriptionMismatch = countSubscriptionSnapshotMismatches(
    latestSubscriptionResult.rows
  )

  return {
    computedAt: new Date().toISOString(),
    duplicateRate: {
      ...toRateMetric(duplicateRows, totalTitledRows),
      duplicateRows,
      totalTitledRows,
    },
    nullTitleRate: {
      ...toRateMetric(nullTitleRows, totalRows),
      nullTitleRows,
      totalRows,
    },
    matchScoreMissingRate: {
      ...toRateMetric(missingMatchScoreRows, matchScoreCoverageTotalRows),
      missingRows: missingMatchScoreRows,
      totalRows: matchScoreCoverageTotalRows,
      sampledUsers,
      sampledJobs,
    },
    watchlistMismatchRate: {
      ...toRateMetric(mismatchedUsers, trackedUsers),
      mismatchedUsers,
      trackedUsers,
      rawRows,
      joinedRows,
    },
    scraperArtifactRate: {
      ...toRateMetric(artifactRows, totalRows),
      artifactRows,
      totalRows,
    },
    trends24h: {
      duplicateRate: buildRateTrend({
        currentNumerator: trendCurrentDuplicateRows,
        currentDenominator: trendCurrentTotalTitledRows,
        previousNumerator: trendPreviousDuplicateRows,
        previousDenominator: trendPreviousTotalTitledRows,
      }),
      nullTitleRate: buildRateTrend({
        currentNumerator: trendCurrentNullTitleRows,
        currentDenominator: trendCurrentTotalRows,
        previousNumerator: trendPreviousNullTitleRows,
        previousDenominator: trendPreviousTotalRows,
      }),
      scraperArtifactRate: buildRateTrend({
        currentNumerator: trendCurrentArtifactRows,
        currentDenominator: trendCurrentTotalRows,
        previousNumerator: trendPreviousArtifactRows,
        previousDenominator: trendPreviousTotalRows,
      }),
    },
    subscriptionMismatchRate: {
      ...toRateMetric(
        subscriptionMismatch.mismatchedSnapshots,
        subscriptionMismatch.trackedSnapshots
      ),
      mismatchedSnapshots: subscriptionMismatch.mismatchedSnapshots,
      trackedSnapshots: subscriptionMismatch.trackedSnapshots,
    },
  }
}
