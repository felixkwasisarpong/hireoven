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
import { computeConfidence } from "@/lib/discovery/confidence-score"
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

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const startedAt = Date.now()
  const pool = getPostgresPool()

  // Claim a batch from the probe queue (highest job_count first) and mark it
  // probed immediately so concurrent/next runs don't re-claim the same rows.
  const { rows: batch } = await pool.query<{ id: string; name: string }>(
    `UPDATE companies SET ats_probe_attempted_at = now()
      WHERE id IN (
        SELECT id FROM companies
         WHERE ats_type IS NULL AND ats_probe_attempted_at IS NULL
           AND is_active = true AND duplicate_of_company_id IS NULL
           AND name IS NOT NULL AND length(trim(name)) >= 2
         ORDER BY job_count DESC NULLS LAST
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, name`,
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
        const slugs = generateSlugCandidates(company.name).slice(0, MAX_SLUGS_PER_NAME)
        processed.add(company.id)
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
            if (result.kind !== "hit" || result.jobsFound === 0) continue

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
              if (await enroll(pool, { ats, slug, name: humanizeSeedSlug(ats, slug) || company.name })) {
                enrolled += 1
                known.add(`${ats}:${slug.toLowerCase()}`)
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
