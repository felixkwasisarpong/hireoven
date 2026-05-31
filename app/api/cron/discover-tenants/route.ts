/**
 * GET /api/cron/discover-tenants
 *
 * Automated ATS-tenant discovery. Resolves unmatched companies (those we hold
 * with jobs but no `ats_type` — e.g. Dice/WAAS/aggregator rows) to their real
 * ATS board by probing name-derived slugs against the ATS APIs, then enrolls
 * the original career source through the confidence gate.
 *
 * This is the automated form of the manual `discover-*-tenants.ts` scripts:
 *  - Reuses the harvester ADAPTERS for the probe (so Workable's POST fix,
 *    pagination, timeouts, etc. all come for free).
 *  - Reuses generateSlugCandidates() so name→slug matches the scripts.
 *  - Bounded per run (HARVEST budget ~250s) and cursor-driven via
 *    companies.ats_probe_attempted_at, so it advances through the backlog
 *    instead of re-probing the newest rows.
 *
 * Env:
 *   CRON_SECRET                      required auth header
 *   DISCOVER_TENANTS_BATCH           companies to probe per run (default 120)
 *   DISCOVER_TENANTS_CONCURRENCY     parallel companies (default 8)
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

function batchSize(): number {
  const n = Number.parseInt(process.env.DISCOVER_TENANTS_BATCH ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 120
}
function concurrency(): number {
  const n = Number.parseInt(process.env.DISCOVER_TENANTS_CONCURRENCY ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 8
}

type ProbeHit = { jobsFound: number; usaConfirmed: boolean; usaJobCount: number }

/** Probe one (ats, slug) via its adapter. Returns null on miss/error (a missing
 *  tenant 404s fast), or job stats on a live board. */
async function probe(ats: AtsName, slug: string): Promise<ProbeHit | null> {
  const url = canonicalCareersUrl(ats, slug)
  if (!url) return null
  const det = detectAdapter(url)
  if (!det || det.adapter.name !== ats) return null
  try {
    const res = await det.adapter.fetchJobs({
      slug: det.slug,
      ctx: { etag: null, lastModified: null, timeoutMs: PROBE_TIMEOUT_MS },
    })
    let usaJobCount = 0
    for (const job of res.jobs) {
      if (isUsaLocation(job.location ?? null)) usaJobCount += 1
    }
    return { jobsFound: res.jobs.length, usaConfirmed: usaJobCount > 0, usaJobCount }
  } catch {
    return null
  }
}

async function enroll(
  pool: Pool,
  args: { ats: AtsName; slug: string; name: string }
): Promise<boolean> {
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

  // ── Claim a batch from the probe queue (highest job_count first) and mark it
  //    probed immediately so concurrent/next runs don't re-claim the same rows.
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

  // Dedup: skip (ats, slug) pairs we already hold.
  const { rows: knownRows } = await pool.query<{ ats_type: string; ats_id: string }>(
    `SELECT ats_type, lower(ats_identifier) AS ats_id FROM companies
      WHERE ats_type = ANY($1::text[]) AND ats_identifier IS NOT NULL`,
    [PROBE_ATSES]
  )
  const known = new Set(knownRows.map((r) => `${r.ats_type}:${r.ats_id}`))

  const limit = pLimit(concurrency())
  let probed = 0
  let enrolled = 0
  let held = 0
  let rejected = 0
  let budgetHit = false

  await Promise.all(
    batch.map((company) =>
      limit(async () => {
        if (Date.now() - startedAt > TIME_BUDGET_MS) { budgetHit = true; return }
        const slugs = generateSlugCandidates(company.name).slice(0, MAX_SLUGS_PER_NAME)
        if (slugs.length === 0) return

        for (const ats of PROBE_ATSES) {
          for (const slug of slugs) {
            if (known.has(`${ats}:${slug.toLowerCase()}`)) continue
            probed += 1
            const hit = await probe(ats, slug)
            // Require real jobs to count as a match. A 200/empty response is NOT
            // proof of a tenant — SmartRecruiters returns 200 + jobs=0 for ANY
            // slug (verified), and an empty board can't be USA-verified anyway.
            if (!hit || hit.jobsFound === 0) continue

            const { score, decision, rejectedReason } = computeConfidence({
              atsMatch: true, apiHttp200: true, jobsFound: hit.jobsFound,
              usaConfirmed: hit.usaConfirmed, usaJobCount: hit.usaJobCount,
              fromCuratedSeed: false, fromCommonCrawl: false,
              isJobDetailPageOnly: false, isDnsFailure: false,
              isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
              priorRejections: 0,
              usaRejected: hit.jobsFound > 0 && !hit.usaConfirmed,
            })

            if (decision === "enroll") {
              if (await enroll(pool, { ats, slug, name: humanizeSeedSlug(ats, slug) || company.name })) {
                enrolled += 1
                known.add(`${ats}:${slug.toLowerCase()}`)
              }
            } else {
              await holdCandidate(pool, {
                ats, slug, score, usaConfirmed: hit.usaConfirmed, jobsFound: hit.jobsFound,
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
    budgetHit,
    durationMs: Date.now() - startedAt,
  })
}
