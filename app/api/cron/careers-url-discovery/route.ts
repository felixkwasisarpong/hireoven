/**
 * GET /api/cron/careers-url-discovery
 *
 * Multi-stage company careers/ATS discovery:
 *   1. Probe likely careers URLs from company domain.
 *   2. Follow redirects and inspect final URL + HTML links/scripts/iframes/JSON.
 *   3. Optionally render with Playwright for network-request evidence.
 *   4. Verify ATS candidates with scoring and store every uncertain candidate.
 *   5. Promote verified, harvestable ATS URLs back onto companies.
 *
 * Env:
 *   CAREERS_DISCOVERY_BATCH       companies per run (default: 50)
 *   CAREERS_DISCOVERY_PLAYWRIGHT  set to 1 to enable last-resort render/network inspection
 */

import { NextRequest, NextResponse } from "next/server"
import type { Pool } from "pg"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { classifyCareersPageHtml } from "@/lib/companies/careers-url-discovery"
import { detectAdapter } from "@/lib/harvester/adapters"
import {
  extractAtsCandidates,
  generateEnterpriseAtsSearchQueries,
  inspectCareersPageWithPlaywright,
  verifyAtsCandidate,
  verifyAtsCandidateUrl,
  type AtsCandidate,
  type AtsCandidateVerification,
  type PageSnapshot,
} from "@/lib/companies/ats-candidates"

export const runtime = "nodejs"
export const maxDuration = 270

const DEFAULT_BATCH = Number(process.env.CAREERS_DISCOVERY_BATCH ?? "50")
const MAX_BATCH = 100
const PROBE_TIMEOUT_MS = 8_000
const MAX_ATS_VERIFICATIONS_PER_COMPANY = 4
const USELESS_URL_RE = /linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com/i

const PROMOTABLE_ATS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "recruitee",
  "bamboohr",
  "jobvite",
  "icims",
  "successfactors",
  "taleo",
  "oraclecloud",
])

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string | null
  ats_type: string | null
}

type ProbeResult = {
  ok: boolean
  status: number | null
  requestedUrl: string
  finalUrl: string
  html: string | null
}

function candidateUrls(domain: string, existingCareersUrl?: string | null): string[] {
  const bare = domain.replace(/^www\./, "")
  const out = new Set<string>()
  if (existingCareersUrl && !USELESS_URL_RE.test(existingCareersUrl)) out.add(existingCareersUrl)
  for (const url of [
    `https://careers.${bare}`,
    `https://jobs.${bare}`,
    `https://www.${bare}/careers`,
    `https://www.${bare}/jobs`,
    `https://${bare}/careers`,
    `https://${bare}/jobs`,
    `https://www.${bare}/careers/jobs`,
    `https://www.${bare}/join-us`,
    `https://www.${bare}/work-with-us`,
    `https://www.${bare}/open-positions`,
    `https://www.${bare}/opportunities`,
    `https://hiring.${bare}`,
    `https://apply.${bare}`,
  ]) {
    out.add(url)
  }
  return [...out]
}

async function probeUrl(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    })
    const finalUrl = response.url ?? url
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || USELESS_URL_RE.test(finalUrl)) {
      return { ok: false, status: response.status, requestedUrl: url, finalUrl, html: null }
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml") && contentType) {
      return { ok: false, status: response.status, requestedUrl: url, finalUrl, html: null }
    }
    return {
      ok: true,
      status: response.status,
      requestedUrl: url,
      finalUrl,
      html: await response.text(),
    }
  } catch {
    return { ok: false, status: null, requestedUrl: url, finalUrl: url, html: null }
  }
}

function rankCandidate(candidate: AtsCandidate): number {
  let score = 0
  if (candidate.atsType === "workday") score += 100
  if (candidate.atsType === "icims") score += 95
  if (candidate.source === "final_url" || candidate.source === "redirect") score += 20
  if (candidate.sources.includes("link") || candidate.sources.includes("iframe")) score += 10
  if (candidate.sources.includes("network")) score += 8
  return score
}

function nextCheckExpression(seconds: number | null): string {
  return seconds == null ? "NULL" : `now() + (${Math.trunc(seconds)} || ' seconds')::interval`
}

function readBatchSize(request: NextRequest): number {
  const requested = Number(request.nextUrl.searchParams.get("batch") ?? DEFAULT_BATCH)
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_BATCH
  return Math.min(Math.trunc(requested), MAX_BATCH)
}

async function upsertCandidate(
  pool: Pool,
  companyId: string,
  verification: AtsCandidateVerification
) {
  const evidence = {
    ...verification.evidence,
    candidate: {
      url: verification.candidate.candidateUrl,
      host: verification.candidate.host,
      sources: verification.candidate.sources,
      atsIdentifier: verification.candidate.atsIdentifier,
      evidence: verification.candidate.evidence,
    },
    rawScore: verification.rawScore,
  }
  await pool.query(
    `INSERT INTO company_ats_candidates
       (company_id, ats_type, candidate_url, host, source, confidence,
        evidence_json, status, last_checked_at, next_check_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now(),${nextCheckExpression(verification.nextCheckSeconds)})
     ON CONFLICT (company_id, candidate_url) DO UPDATE
       SET ats_type = EXCLUDED.ats_type,
           host = EXCLUDED.host,
           source = EXCLUDED.source,
           confidence = GREATEST(company_ats_candidates.confidence, EXCLUDED.confidence),
           evidence_json = EXCLUDED.evidence_json,
           status = EXCLUDED.status,
           last_checked_at = now(),
           next_check_at = EXCLUDED.next_check_at,
           updated_at = now()`,
    [
      companyId,
      verification.candidate.atsType,
      verification.candidate.candidateUrl,
      verification.candidate.host,
      verification.candidate.source,
      verification.confidence,
      JSON.stringify(evidence),
      verification.status,
    ]
  )
}

async function upsertSearchQueryCandidate(pool: Pool, company: CompanyRow) {
  const queries = generateEnterpriseAtsSearchQueries(company.name)
  if (queries.length === 0) return
  await pool.query(
    `INSERT INTO company_ats_candidates
       (company_id, ats_type, candidate_url, host, source, confidence,
        evidence_json, status, last_checked_at, next_check_at)
     VALUES ($1,'workday',$2,$3,'search_query',0,$4::jsonb,'pending',now(),now() + interval '1 day')
     ON CONFLICT (company_id, candidate_url) DO UPDATE
       SET evidence_json = EXCLUDED.evidence_json,
           status = 'pending',
           last_checked_at = now(),
           next_check_at = EXCLUDED.next_check_at,
           updated_at = now()`,
    [
      company.id,
      `search://${encodeURIComponent(company.name)}`,
      company.domain,
      JSON.stringify({
        signals: ["direct_detection_failed_search_queries_generated"],
        searchQueries: queries,
      }),
    ]
  )
}

function shouldPromote(verification: AtsCandidateVerification): boolean {
  const detected = detectAdapter(verification.candidate.candidateUrl)
  return (
    PROMOTABLE_ATS.has(verification.candidate.atsType) &&
    Boolean(detected && detected.adapter.name === verification.candidate.atsType) &&
    (verification.status === "verified" || verification.status === "verified_no_jobs")
  )
}

async function promoteCompany(
  pool: Pool,
  company: CompanyRow,
  verification: AtsCandidateVerification
) {
  const nextHarvestSql =
    verification.status === "verified"
      ? "now()"
      : "now() + interval '8 hours'"
  const tier = verification.status === "verified" ? "tier_2" : "tier_3"
  const evidence = {
    source: "cron:careers-url-discovery",
    confidence: verification.confidence,
    status: verification.status,
    factors: verification.evidence.factors,
    candidateUrl: verification.candidate.candidateUrl,
    detectedAt: new Date().toISOString(),
  }

  await pool.query(
    `UPDATE companies
        SET careers_url = $1,
            direct_ats_url = $1,
            ats_type = $2,
            ats_identifier = $3,
            is_active = true,
            status = 'active',
            crawl_allowed = true,
            freshness_tier = $4,
            discovered_via = COALESCE(discovered_via, 'cron:careers-url-discovery'),
            next_harvest_at = ${nextHarvestSql},
            raw_ats_config = jsonb_set(
              COALESCE(raw_ats_config, '{}'::jsonb),
              '{ats_candidate_detection}',
              $5::jsonb,
              true
            ),
            careers_discovery_attempted_at = now(),
            updated_at = now()
      WHERE id = $6`,
    [
      verification.candidate.candidateUrl,
      verification.candidate.atsType,
      verification.candidate.atsIdentifier,
      tier,
      JSON.stringify(evidence),
      company.id,
    ]
  )
}

async function verifyCandidatesForPage(input: {
  company: CompanyRow
  page: PageSnapshot
}): Promise<AtsCandidateVerification[]> {
  const staticCandidates = extractAtsCandidates({
    companyName: input.company.name,
    companyDomain: input.company.domain,
    page: input.page,
  })
  let candidates = staticCandidates

  if (candidates.length === 0 && process.env.CAREERS_DISCOVERY_PLAYWRIGHT === "1") {
    const rendered = await inspectCareersPageWithPlaywright({
      url: input.page.finalUrl ?? input.page.url,
      timeoutMs: 12_000,
    })
    if (rendered) {
      candidates = extractAtsCandidates({
        companyName: input.company.name,
        companyDomain: input.company.domain,
        page: rendered,
      })
    }
  }

  const ranked = [...candidates]
    .sort((a, b) => rankCandidate(b) - rankCandidate(a))
    .slice(0, MAX_ATS_VERIFICATIONS_PER_COMPANY)

  const verifications: AtsCandidateVerification[] = []
  for (const candidate of ranked) {
    const samePage = candidate.host === new URL(input.page.finalUrl ?? input.page.url).hostname.toLowerCase()
    const verification = samePage
      ? verifyAtsCandidate({
          candidate,
          companyName: input.company.name,
          companyDomain: input.company.domain,
          officialPageHtml: input.page.html,
          candidatePageHtml: input.page.html,
          candidateFinalUrl: input.page.finalUrl ?? input.page.url,
        })
      : await verifyAtsCandidateUrl({
          candidate,
          companyName: input.company.name,
          companyDomain: input.company.domain,
          officialPageHtml: input.page.html,
          timeoutMs: PROBE_TIMEOUT_MS,
        })
    verifications.push(verification)
  }
  return verifications
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const batch = readBatchSize(request)
  const pool = getPostgresPool()
  const { rows: companies } = await pool.query<CompanyRow>(
    `SELECT id, name, domain, careers_url, ats_type
       FROM companies
      WHERE (ats_type IS NULL OR ats_type = 'custom')
        AND domain IS NOT NULL
        AND domain NOT LIKE '%.placeholder'
        AND domain NOT LIKE '%-discovered'
        AND domain NOT LIKE '%.ats-placeholder'
        AND domain NOT LIKE '%.builtin-discovery'
        AND status != 'dead'
        AND (
          careers_url LIKE '%linkedin.com%' OR
          careers_url LIKE '%indeed.com%' OR
          careers_url LIKE '%glassdoor.com%' OR
          careers_url IS NULL OR
          careers_url NOT LIKE 'http%' OR
          careers_discovery_attempted_at IS NULL
        )
        AND (
          careers_discovery_attempted_at IS NULL
          OR (
            careers_url IS NOT NULL
            AND careers_discovery_attempted_at < now() - interval '1 day'
          )
          OR (
            careers_url IS NULL
            AND careers_discovery_attempted_at < now() - interval '7 days'
          )
        )
      ORDER BY job_count DESC NULLS LAST
      LIMIT $1`,
    [batch]
  )

  const stats = {
    attempted: 0,
    careersFound: 0,
    atsCandidates: 0,
    candidatesStored: 0,
    promoted: 0,
    searchQueryFallbacks: 0,
    notFound: 0,
  }

  for (const company of companies) {
    stats.attempted += 1
    await pool.query(
      `UPDATE companies SET careers_discovery_attempted_at = now(), updated_at = now() WHERE id = $1`,
      [company.id]
    )

    let foundCareersPage = false
    let promoted = false
    let storedCandidate = false

    for (const candidateUrl of candidateUrls(company.domain, company.careers_url)) {
      const probe = await probeUrl(candidateUrl)
      if (!probe.ok || !probe.html) continue

      const classification = classifyCareersPageHtml({ url: probe.finalUrl, html: probe.html })
      const page: PageSnapshot = {
        url: probe.requestedUrl,
        finalUrl: probe.finalUrl,
        html: probe.html,
        redirectChain: probe.finalUrl !== probe.requestedUrl ? [probe.requestedUrl, probe.finalUrl] : [probe.requestedUrl],
      }
      foundCareersPage = true

      const verifications = await verifyCandidatesForPage({ company, page })
      stats.atsCandidates += verifications.length

      for (const verification of verifications) {
        await upsertCandidate(pool, company.id, verification)
        stats.candidatesStored += 1
        storedCandidate = true
      }

      const best = verifications
        .filter(shouldPromote)
        .sort((a, b) => b.confidence - a.confidence)[0]

      if (best) {
        await promoteCompany(pool, company, best)
        stats.promoted += 1
        promoted = true
        break
      }

      if (!storedCandidate) {
        await upsertSearchQueryCandidate(pool, company)
        stats.searchQueryFallbacks += 1
      }

      if (classification.confidence !== "none") {
        await pool.query(
          `UPDATE companies
              SET careers_url = COALESCE(NULLIF(careers_url, ''), $1),
                  crawl_allowed = true,
                  updated_at = now()
            WHERE id = $2`,
          [probe.finalUrl, company.id]
        )
      }

      break
    }

    if (foundCareersPage) stats.careersFound += 1
    if (!foundCareersPage) {
      await upsertSearchQueryCandidate(pool, company)
      stats.searchQueryFallbacks += 1
      stats.notFound += 1
    } else if (!promoted && !storedCandidate) {
      stats.notFound += 1
    }
  }

  return NextResponse.json({ ok: true, ...stats })
}
