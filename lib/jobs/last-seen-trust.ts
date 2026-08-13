/**
 * Is a row's `jobs.last_seen_at` trustworthy as a liveness signal?
 *
 * Background. `persistJobsBulk` used to update a row only when its
 * `content_hash` changed, so a live job whose description never changes kept a
 * stale `last_seen_at` while being re-confirmed on every crawl. Any "not seen
 * since <date>" reasoning on such a row was simply false.
 *
 * That is fixed — the upsert now also fires when `last_seen_at` is older than
 * the incoming value — but the fix is FORWARD-ONLY. Rows not re-harvested since
 * it deployed still carry pre-fix values, and there is no way to tell a
 * genuinely-stale row from a never-updated one by looking at the row alone.
 *
 * Hence an epoch, mirroring the `FAST_SCORE_CACHE_EPOCH_ISO` idiom in
 * lib/matching/score-freshness.ts. The comparison is per row, so the rollout
 * heals itself: a job re-crawled after the deploy has `last_seen_at >= epoch`
 * and becomes trusted, while one not yet re-crawled stays below it and stays
 * untrusted. No waiting for a full crawl cycle, and no backfill.
 *
 * The failure modes are asymmetric, which is why the default is what it is:
 *   - epoch too LATE  -> we distrust some good data. We lose signal. Safe.
 *   - epoch too EARLY -> we trust pre-fix values and can tell someone a live
 *                        job looks abandoned. Not safe.
 * So err late, and treat "unset" as "trust nothing".
 */

/**
 * When the `persist-bulk` last-seen fix finished deploying, as an ISO-8601
 * UTC string.
 *
 * ─── HOW TO SET THIS ─────────────────────────────────────────────────────────
 *
 * 1. Merge and deploy the fix. BOTH boxes run `persistJobsBulk` — the harvester
 *    worker (scripts/harvester-worker.ts) and the web box's crawl route
 *    (app/api/crawl/route.ts) — and they do not deploy together.
 * 2. Take the timestamp of whichever finished LAST, in UTC.
 * 3. Round it UP to the next hour. Cheap insurance against clock skew between
 *    the boxes and the database.
 * 4. Replace `null` below with that string, e.g. "2026-08-14T15:00:00.000Z".
 *
 * Leave it `null` until then. Null means every row is untrusted, which costs
 * signal but cannot produce a false "this job is gone".
 */
export const HARVESTER_LAST_SEEN_EPOCH_ISO: string | null = null

export const HARVESTER_LAST_SEEN_EPOCH_MS: number | null =
  HARVESTER_LAST_SEEN_EPOCH_ISO === null ? null : Date.parse(HARVESTER_LAST_SEEN_EPOCH_ISO)

if (HARVESTER_LAST_SEEN_EPOCH_MS !== null && !Number.isFinite(HARVESTER_LAST_SEEN_EPOCH_MS)) {
  throw new Error("Invalid HARVESTER_LAST_SEEN_EPOCH_ISO")
}

/**
 * Which write path produced the row. Only the harvester path was affected: the
 * legacy crawler (lib/crawler/persist.ts) and aggregator ingestion
 * (lib/jobs/aggregator-ingest.ts) always advanced `last_seen_at`, so their rows
 * are trustworthy regardless of the epoch.
 */
export type JobIngestionPath = "harvester" | "legacy_crawler" | "aggregator" | "unknown"

export type LastSeenTrustInput = {
  lastSeenAt: string | null | undefined
  ingestionPath: JobIngestionPath
}

export type LastSeenTrustResult = {
  trustworthy: boolean
  /** Why not, for the data-gap explanation. Null when trustworthy. */
  reason:
    | "epoch_not_set"
    | "written_before_fix"
    | "missing_timestamp"
    | "unknown_ingestion_path"
    | null
}

/**
 * Whether `last_seen_at` may back a finding for this row.
 *
 * When this returns false the field must not be read at all — not shown, not
 * scored, and never phrased as "not seen since". Fall back to
 * `companies.last_crawled_at` for "we checked the board" and `jobs.is_active`
 * for "the job disappeared from source".
 */
export function isLastSeenTrustworthy(input: LastSeenTrustInput): LastSeenTrustResult {
  if (!input.lastSeenAt) {
    return { trustworthy: false, reason: "missing_timestamp" }
  }

  // Paths that always advanced the timestamp are unaffected by the fix.
  if (input.ingestionPath === "legacy_crawler" || input.ingestionPath === "aggregator") {
    return { trustworthy: true, reason: null }
  }

  // An unattributable row might have come through the harvester, so treat it
  // with the same suspicion.
  if (input.ingestionPath === "unknown") {
    return { trustworthy: false, reason: "unknown_ingestion_path" }
  }

  if (HARVESTER_LAST_SEEN_EPOCH_MS === null) {
    return { trustworthy: false, reason: "epoch_not_set" }
  }

  const lastSeenMs = Date.parse(input.lastSeenAt)
  if (!Number.isFinite(lastSeenMs)) {
    return { trustworthy: false, reason: "missing_timestamp" }
  }

  return lastSeenMs >= HARVESTER_LAST_SEEN_EPOCH_MS
    ? { trustworthy: true, reason: null }
    : { trustworthy: false, reason: "written_before_fix" }
}

/** Human-readable explanation for a data gap or an expandable caveat. */
export function lastSeenTrustExplanation(reason: LastSeenTrustResult["reason"]): string | null {
  switch (reason) {
    case "epoch_not_set":
      return "We are not yet treating last-seen timestamps from the harvester as reliable."
    case "written_before_fix":
      return "This listing has not been re-checked since we improved how freshness is recorded, so its last-seen time may be older than reality."
    case "missing_timestamp":
      return "No last-seen timestamp is recorded for this listing."
    case "unknown_ingestion_path":
      return "We cannot tell which pipeline recorded this listing, so its last-seen time is not relied on."
    default:
      return null
  }
}
