/**
 * GET /api/cron/discover-tenants
 *
 * Automated ATS-tenant discovery. Resolves unmatched companies (those we hold
 * with jobs but no `ats_type` — e.g. Dice/WAAS/aggregator rows) to their real
 * ATS board by probing name-derived slugs against the ATS APIs, then enrolls
 * the original career source through the confidence gate.
 *
 * This is the automated form of the manual `discover-*-tenants.ts` scripts, but
 * built to NOT trip ATS WAFs (the bulk scripts get a residential IP 403/429'd
 * after a few thousand probes). WAF-avoidance here is threefold:
 *   1. Per-ATS concurrency cap — never more than PER_ATS_CONCURRENCY in-flight
 *      requests to a single vendor host, so we never burst greenhouse/lever/etc.
 *   2. Per-probe stagger — a small delay smooths the request rate.
 *   3. WAF circuit-breaker — if a rolling window of probes shows too many
 *      403/406/429s, the run aborts and un-claims the unprobed batch so nothing
 *      is skipped (it retries next run).
 * Combined with the small per-run batch, the request rate per host stays well
 * under WAF thresholds.
 *
 * Env:
 *   CRON_SECRET                      required auth header
 *   DISCOVER_TENANTS_BATCH           companies to probe per run (default 120)
 *   DISCOVER_TENANTS_CONCURRENCY     parallel companies (default 6)
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { computeConfidence, fastPathDecision } from "@/lib/discovery/confidence-score"
import { enrollTenantAsCompany } from "@/lib/discovery/enroll-tenant-as-company"
import { resolveApplyUrlToAtsTenant } from "@/lib/discovery/resolve-apply-url-to-tenant"
import { CANDIDATE_PRIORITY_ORDER_SQL } from "@/lib/discovery/candidate-priority"
import { counter } from "@/lib/observability/metrics"
import { isUsaLocation } from "@/lib/discovery/usa-confirm"
import { generateSlugCandidates } from "@/lib/discovery/slug-candidates"
import { humanizeSeedSlug } from "@/lib/discovery/seed-slug"
import type { Pool } from "pg"

export const runtime = "nodejs"
export const maxDuration = 300

// Slug-based ATSes whose tenant lives at a name-derived slug. Ordered by
// observed hit-rate so a company that matches early stops probing the rest.
const PROBE_ATSES: AtsName[] = ["greenhouse", "ashby", "lever", "smartrecruiters", "workable", "bamboohr"]

const TIME_BUDGET_MS = 250_000
const PROBE_TIMEOUT_MS = 7_000
const MAX_SLUGS_PER_NAME = 2

// ─── WAF-avoidance knobs ──────────────────────────────────────────────────────
// Max simultaneous requests to a SINGLE ATS host. Keeping this at 2 means even
// at high outer concurrency we never burst one vendor (the bulk scripts hit
// concurrency 16 against one host and got throttled).
const PER_ATS_CONCURRENCY = 2
// Delay before each probe — smooths the per-host request rate.
const PROBE_STAGGER_MS = 150
// Per-ATS circuit-breaker: if a single ATS platform returns WAF responses on
// more than WAF_ABORT_FRACTION of its last WAF_WINDOW probes, skip that ATS
// for the rest of this run. Other ATSes continue unaffected — one throttled
// platform no longer kills the whole batch.
const WAF_WINDOW = 20
const WAF_ABORT_FRACTION = 0.4
// 404 (a genuinely missing tenant) also throws — only these statuses mean
// "the host is pushing back; back off".
const WAF_STATUS_RE = /http_?(?:403|406|429)|forbidden|too many requests|rate.?limit/i

function batchSize(): number {
  const n = Number.parseInt(process.env.DISCOVER_TENANTS_BATCH ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 120
}
function concurrency(): number {
  const n = Number.parseInt(process.env.DISCOVER_TENANTS_CONCURRENCY ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 6
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type ProbeResult =
  | { kind: "hit"; jobsFound: number; usaConfirmed: boolean; usaJobCount: number }
  | { kind: "miss" }
  | { kind: "waf" }

/** Probe one (ats, slug) via its adapter. A missing tenant 404s (→ miss); a
 *  throttling host 403/406/429s (→ waf, surfaced so the caller can back off). */
async function probe(ats: AtsName, slug: string): Promise<ProbeResult> {
  const url = canonicalCareersUrl(ats, slug)
  if (!url) return { kind: "miss" }
  const det = detectAdapter(url)
  if (!det || det.adapter.name !== ats) return { kind: "miss" }
  try {
    const res = await det.adapter.fetchJobs({
      slug: det.slug,
      ctx: { etag: null, lastModified: null, timeoutMs: PROBE_TIMEOUT_MS },
    })
    let usaJobCount = 0
    for (const job of res.jobs) {
      if (isUsaLocation(job.location ?? null)) usaJobCount += 1
    }
    return { kind: "hit", jobsFound: res.jobs.length, usaConfirmed: usaJobCount > 0, usaJobCount }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return WAF_STATUS_RE.test(msg) ? { kind: "waf" } : { kind: "miss" }
  }
}

async function enroll(pool: Pool, args: { ats: AtsName; slug: string; name: string }): Promise<boolean> {
  const careersUrl = canonicalCareersUrl(args.ats, args.slug)
  if (!careersUrl) return false
  const domain = `${args.slug}.${args.ats}-discovered`
  try {
    const r = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at)
       VALUES ($1,$2,$3,$4,$5,true,'active','tier_2',$6,now())
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [args.name, domain, careersUrl, args.ats, args.slug, `cron:discover-tenants:${args.ats}`]
    )
    return Boolean(r.rowCount && r.rowCount > 0)
  } catch {
    return false
  }
}

async function holdCandidate(
  pool: Pool,
  args: { ats: AtsName; slug: string; score: number; usaConfirmed: boolean; jobsFound: number; rejectedReason: string | null; hold: boolean }
) {
  const careersUrl = canonicalCareersUrl(args.ats, args.slug)
  const nextRetry = args.hold ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
  await pool
    .query(
      `INSERT INTO discovered_candidates
         (raw_url, ats_type, ats_identifier, normalized_url, source,
          confidence_score, usa_confirmed, jobs_at_discovery, rejected_reason, next_retry_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
      [careersUrl, args.ats, args.slug, careersUrl, `cron:discover-tenants:${args.ats}`,
       args.score, args.usaConfirmed, args.jobsFound, args.rejectedReason, nextRetry]
    )
    .catch(() => { /* non-fatal */ })
}

/**
 * Fast-path retry_later: a real but empty board from a high-trust ATS. Register
 * the tenant (so we remember the board exists and recheck it) without creating
 * a company. Requires the ats_tenants table (add-ats-tenants migration).
 */
async function registerTenantForRetry(
  pool: Pool,
  args: { ats: AtsName; slug: string; confidence: number; jobCount: number; name: string }
) {
  const careersUrl = canonicalCareersUrl(args.ats, args.slug)
  await pool
    .query(
      `INSERT INTO ats_tenants
         (ats_type, ats_identifier, source_url, source_type, company_name_guess,
          confidence, job_count, status, last_checked_at, next_check_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'retry_later', now(), now() + interval '7 days')
       ON CONFLICT (ats_type, ats_identifier) DO UPDATE
         SET confidence      = GREATEST(ats_tenants.confidence, EXCLUDED.confidence),
             job_count       = EXCLUDED.job_count,
             status          = CASE WHEN ats_tenants.status = 'enrolled' THEN ats_tenants.status ELSE 'retry_later' END,
             last_checked_at = now(),
             next_check_at   = now() + interval '7 days',
             updated_at      = now()`,
      [args.ats, args.slug, careersUrl, `discover-tenants:${args.ats}`, args.name, args.confidence, args.jobCount]
    )
    .catch(() => { /* non-fatal — table may not exist yet */ })
  counter("tenant.retry_later", { atsType: args.ats, sourceType: "discover-tenants", reason: "empty_board" })
}

/**
 * Record a resolution attempt against the placeholder: bump the attempt counter
 * and stamp the cooldown. On success, clear last_resolution_failed_at; on
 * failure, set it (drives the priority penalty + 24h short cooldown).
 */
async function markResolution(pool: Pool, companyId: string, success: boolean): Promise<void> {
  await pool
    .query(
      `UPDATE companies SET
         resolution_attempts = COALESCE(resolution_attempts, 0) + 1,
         last_resolution_attempted_at = now(),
         last_resolution_failed_at = CASE WHEN $2 THEN NULL ELSE now() END
       WHERE id = $1`,
      [companyId, success]
    )
    .catch(() => { /* non-fatal bookkeeping */ })
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const startedAt = Date.now()
  const pool = getPostgresPool()

  // Claim a batch from the probe queue, ordered by a priority score (apply-url
  // and real-domain placeholders with jobs first; chronic failures sink). The
  // claim atomically stamps last_resolution_attempted_at so concurrent/next runs
  // skip these rows; the 1-hour cooldown lets a placeholder be retried later
  // (with a growing resolution_attempts penalty). The dead/duplicate/name guards
  // are retained from the previous query. Each row carries one sample apply_url
  // so the loop can backsolve before falling back to slug enumeration.
  const { rows: batch } = await pool.query<{ id: string; name: string; apply_url: string | null }>(
    `UPDATE companies SET last_resolution_attempted_at = now()
      WHERE id IN (
        SELECT c.id FROM companies c
         WHERE c.ats_type IS NULL
           AND c.is_active = false
           AND c.duplicate_of_company_id IS NULL
           AND c.status <> 'dead'
           AND c.name IS NOT NULL AND length(trim(c.name)) >= 2
           AND (c.last_resolution_attempted_at IS NULL
                OR c.last_resolution_attempted_at < now() - interval '1 hour')
         ORDER BY (${CANDIDATE_PRIORITY_ORDER_SQL}) DESC, COALESCE(c.job_count, 0) DESC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, name,
        (SELECT j.apply_url FROM jobs j
          WHERE j.company_id = companies.id AND j.apply_url IS NOT NULL
          LIMIT 1) AS apply_url`,
    [batchSize()]
  )

  if (batch.length === 0) {
    return NextResponse.json({ ok: true, message: "probe queue empty", enrolled: 0 })
  }

  const { rows: knownRows } = await pool.query<{ ats_type: string; ats_id: string }>(
    `SELECT ats_type, lower(ats_identifier) AS ats_id FROM companies
      WHERE ats_type = ANY($1::text[]) AND ats_identifier IS NOT NULL`,
    [PROBE_ATSES]
  )
  const known = new Set(knownRows.map((r) => `${r.ats_type}:${r.ats_id}`))

  const limit = pLimit(concurrency())
  // Per-host limiter — the core WAF guard. Each ATS gets its own small pool.
  const atsLimit = new Map<AtsName, ReturnType<typeof pLimit>>()
  for (const a of PROBE_ATSES) atsLimit.set(a, pLimit(PER_ATS_CONCURRENCY))

  let probed = 0, enrolled = 0, held = 0, rejected = 0
  let budgetHit = false, wafAborted = false
  const processed = new Set<string>()

  // Per-ATS sliding window — tracks WAF rate independently for each platform.
  // If one ATS starts throttling, skip it for the rest of this run while the
  // others keep running. The global wafAborted flag only fires when ALL
  // remaining ATSes are throttled.
  const atsWafWindow = new Map<AtsName, boolean[]>()
  const atsSkipped = new Set<AtsName>()
  for (const a of PROBE_ATSES) atsWafWindow.set(a, [])

  const noteWaf = (ats: AtsName, isWaf: boolean) => {
    const w = atsWafWindow.get(ats)!
    w.push(isWaf)
    if (w.length > WAF_WINDOW) w.shift()
    if (w.length === WAF_WINDOW && w.filter(Boolean).length / WAF_WINDOW > WAF_ABORT_FRACTION) {
      atsSkipped.add(ats)
      if (atsSkipped.size === PROBE_ATSES.length) wafAborted = true
    }
  }

  await Promise.all(
    batch.map((company) =>
      limit(async () => {
        if (budgetHit) return
        if (Date.now() - startedAt > TIME_BUDGET_MS) { budgetHit = true; return }
        processed.add(company.id)
        let resolved = false
        try {
        // Behavior 1: if this placeholder's jobs carry an apply URL, backsolve it
        // first — it's cheaper and more precise than slug enumeration. If the
        // backsolver resolves the board, skip slug probing entirely.
        if (company.apply_url) {
          const r = await resolveApplyUrlToAtsTenant(company.apply_url, "discover-tenants")
          if (r.success && r.confidence >= 60 && r.atsType && r.atsIdentifier) {
            const res = await enrollTenantAsCompany(pool, {
              atsType: r.atsType,
              atsIdentifier: r.atsIdentifier,
              confidence: r.confidence,
              jobCount: r.jobCount,
              sourceUrl: company.apply_url,
              sourceType: "discover-tenants:apply-url",
              companyNameGuess: company.name,
              domainGuess: r.domainGuess,
            }).catch(() => null)
            if (res) {
              if (res.created) enrolled += 1
              known.add(`${r.atsType}:${r.atsIdentifier.toLowerCase()}`)
              resolved = true
              return
            }
          }
          // Backsolver didn't resolve → fall through to slug probing.
        }

        const slugs = generateSlugCandidates(company.name).slice(0, MAX_SLUGS_PER_NAME)
        if (slugs.length === 0) return

        for (const ats of PROBE_ATSES) {
          if (atsSkipped.has(ats)) continue
          for (const slug of slugs) {
            if (budgetHit) return
            if (known.has(`${ats}:${slug.toLowerCase()}`)) continue
            probed += 1
            const result = await atsLimit.get(ats)!(async () => {
              await sleep(PROBE_STAGGER_MS)
              return probe(ats, slug)
            })
            noteWaf(ats, result.kind === "waf")
            if (result.kind !== "hit") continue

            const candidateName = humanizeSeedSlug(ats, slug) || company.name

            // Fast path: a clean board response from a high-trust ATS is
            // conclusive. ≥1 job ⇒ enroll directly (skip the heuristic score);
            // an empty board ⇒ register the tenant for a later recheck.
            const fast = fastPathDecision({
              atsType: ats,
              endpointStatus: result.jobsFound >= 1 ? "ok" : "empty",
              jobCount: result.jobsFound,
            })

            // Only fast-enroll US/Canada-confirmed boards. A board with jobs but
            // no US/CA listings is out-of-market for this product; let it fall
            // through to computeConfidence, which rejects it (usaRejected) exactly
            // as before. (Deliberate guard — the spec's fastPathDecision ignores
            // geography.)
            if (fast.decision === "enroll" && result.usaConfirmed) {
              const res = await enrollTenantAsCompany(pool, {
                atsType: ats,
                atsIdentifier: slug,
                confidence: fast.confidence,
                jobCount: result.jobsFound,
                sourceType: `discover-tenants:${ats}`,
                companyNameGuess: candidateName,
              }).catch(() => null)
              if (res?.created) enrolled += 1
              known.add(`${ats}:${slug.toLowerCase()}`)
              if (res) resolved = true
              return
            }

            if (fast.decision === "retry_later") {
              await registerTenantForRetry(pool, {
                ats, slug, confidence: fast.confidence, jobCount: result.jobsFound, name: candidateName,
              })
              held += 1
              return
            }

            // Fall through: empty already handled above; a no-job hit has nothing
            // to score, and a non-US hit with jobs goes through the full gate.
            if (result.jobsFound === 0) continue

            const { score, decision, rejectedReason } = computeConfidence({
              atsMatch: true, apiHttp200: true, jobsFound: result.jobsFound,
              usaConfirmed: result.usaConfirmed, usaJobCount: result.usaJobCount,
              fromCuratedSeed: false, fromCommonCrawl: false,
              isJobDetailPageOnly: false, isDnsFailure: false,
              isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
              priorRejections: 0,
              usaRejected: !result.usaConfirmed,
            })

            if (decision === "enroll") {
              if (await enroll(pool, { ats, slug, name: candidateName })) {
                enrolled += 1
                known.add(`${ats}:${slug.toLowerCase()}`)
                resolved = true
              }
            } else {
              await holdCandidate(pool, {
                ats, slug, score, usaConfirmed: result.usaConfirmed, jobsFound: result.jobsFound,
                rejectedReason, hold: decision === "hold",
              })
              if (decision === "hold") held += 1; else rejected += 1
            }
            // A company lives on one ATS — stop probing once matched.
            return
          }
        }
        } finally {
          // Record the attempt (counter + cooldown). Skipped for budget bail-outs
          // above (they return before this try block).
          await markResolution(pool, company.id, resolved)
        }
      })
    )
  )

  // On a WAF abort, un-claim the companies we never got to so they retry next
  // run instead of being silently marked probed.
  if (wafAborted) {
    const unprobed = batch.filter((c) => !processed.has(c.id)).map((c) => c.id)
    if (unprobed.length > 0) {
      await pool
        .query(`UPDATE companies SET ats_probe_attempted_at = NULL WHERE id = ANY($1::uuid[])`, [unprobed])
        .catch(() => { /* non-fatal */ })
    }
  }

  await pool
    .query(
      `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected, duration_ms)
       VALUES ('cron:discover-tenants',$1,$2,$3,$4,$5)`,
      [probed, enrolled, held, rejected, Date.now() - startedAt]
    )
    .catch(() => { /* non-fatal */ })

  return NextResponse.json({
    ok: true,
    batch: batch.length,
    probed,
    enrolled,
    held,
    rejected,
    wafAborted,
    budgetHit,
    durationMs: Date.now() - startedAt,
  })
}
