/**
 * Overnight ATS discovery for companies with jobs but no harvester configured.
 *
 * Processes all active companies where:
 *   - ats_type IS NULL (no harvester)
 *   - job_count > 0 (has jobs in our DB — companies with zero are skipped)
 *   - domain is a real domain (not a placeholder/discovery artifact)
 *
 * Three-tier fallback per company:
 *   1. Standard ATS detection (static HTML) — Greenhouse, Lever, Ashby, Workday, etc.
 *      If found → wire ats_type + ats_identifier, schedule harvest immediately.
 *   2. Playwright render — for JS-rendered career pages that hide ATS links in the DOM.
 *      Re-runs ATS detection on the rendered HTML.
 *   3. JSON-LD fallback — if no standard ATS found but the careers page embeds
 *      schema.org/JobPosting blocks, wire ats_type = "jsonld" so the jsonld adapter
 *      can harvest the jobs directly from that page.
 *
 * Companies where none of the three tiers succeed have their careers_url captured
 * so a future manual pass or custom adapter can pick them up.
 *
 * Designed to run overnight on the harvester box:
 *   npx tsx scripts/overnight-ats-discovery.ts
 *   npx tsx scripts/overnight-ats-discovery.ts --concurrency=10 --dry-run
 *
 * Env:
 *   DATABASE_URL  — required
 *   SKIP_PLAYWRIGHT=1  — disable Playwright fallback (faster, fewer detections)
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import pLimit from "p-limit"
import {
  extractAtsCandidates,
  verifyAtsCandidateUrl,
  verifyAtsCandidate,
  type AtsCandidate,
  type AtsCandidateVerification,
  type PageSnapshot,
} from "@/lib/companies/ats-candidates"
import { detectAdapter } from "@/lib/harvester/adapters"
import { createPlaywrightRenderer, type PlaywrightRenderer } from "@/lib/companies/playwright-render"
import { extractJsonLdBlocks, mapJsonLdToHarvestedJobs } from "@/lib/harvester/adapters/_json-ld"

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const SKIP_PLAYWRIGHT = process.env.SKIP_PLAYWRIGHT === "1" || args.includes("--skip-playwright")
const CONCURRENCY = Math.max(1, Number(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "8"))
// Per-ATS host concurrency — never burst a single vendor.
const PER_ATS_CONCURRENCY = 2
const PROBE_TIMEOUT_MS = 8_000
const PLAYWRIGHT_TIMEOUT_MS = 18_000
const STAGGER_MS = 120
const MAX_VERIFICATIONS_PER_COMPANY = 4
const USELESS_URL_RE = /linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com/i

const PROMOTABLE_ATS = new Set([
  "greenhouse", "lever", "ashby", "smartrecruiters", "workable",
  "workday", "recruitee", "bamboohr", "jobvite", "icims",
  "successfactors", "taleo", "oraclecloud", "teamtailor", "personio",
])

// ── DB ────────────────────────────────────────────────────────────────────────

function getPool(): Pool {
  const cs = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!cs) throw new Error("Missing DATABASE_URL")
  return new Pool({
    connectionString: cs,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
}

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string | null
  job_count: number
}

async function fetchCompanies(pool: Pool): Promise<CompanyRow[]> {
  const { rows } = await pool.query<CompanyRow>(`
    SELECT id, name, domain, careers_url, job_count
    FROM companies
    WHERE ats_type IS NULL
      AND job_count > 0
      AND domain IS NOT NULL
      AND domain NOT LIKE '%.placeholder'
      AND domain NOT LIKE '%-discovered'
      AND domain NOT LIKE '%.ats-placeholder'
      AND domain NOT LIKE '%.builtin-discovery'
      AND domain NOT LIKE '%.lca-employer'
      AND domain NOT LIKE '%.uscis-employer'
      AND domain NOT LIKE '%myworkdayjobs.com'
      AND (status IS NULL OR status != 'dead')
    ORDER BY is_active DESC, job_count DESC
  `)
  return rows
}

// ── URL probing ───────────────────────────────────────────────────────────────

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
    `https://www.${bare}/about/careers`,
    `https://www.${bare}/join`,
    `https://www.${bare}/join-us`,
    `https://www.${bare}/work-with-us`,
    `https://www.${bare}/open-positions`,
    `https://hiring.${bare}`,
    `https://apply.${bare}`,
  ]) out.add(url)
  return [...out]
}

type ProbeResult = {
  ok: boolean
  requestedUrl: string
  finalUrl: string
  html: string | null
}

async function probeUrl(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    })
    const finalUrl = res.url ?? url
    if (!res.ok || USELESS_URL_RE.test(finalUrl)) return { ok: false, requestedUrl: url, finalUrl, html: null }
    const ct = res.headers.get("content-type") ?? ""
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return { ok: false, requestedUrl: url, finalUrl, html: null }
    return { ok: true, requestedUrl: url, finalUrl, html: await res.text() }
  } catch {
    return { ok: false, requestedUrl: url, finalUrl: url, html: null }
  }
}

// ── ATS detection ─────────────────────────────────────────────────────────────

function rankCandidate(c: AtsCandidate): number {
  let s = 0
  if (c.atsType === "workday") s += 100
  if (c.atsType === "icims") s += 95
  if (c.source === "final_url" || c.source === "redirect") s += 20
  if (c.sources.includes("link") || c.sources.includes("iframe")) s += 10
  return s
}

function shouldPromote(v: AtsCandidateVerification): boolean {
  const detected = detectAdapter(v.candidate.candidateUrl)
  return (
    PROMOTABLE_ATS.has(v.candidate.atsType) &&
    Boolean(detected && detected.adapter.name === v.candidate.atsType) &&
    (v.status === "verified" || v.status === "verified_no_jobs")
  )
}

async function detectFromPage(
  company: CompanyRow,
  page: PageSnapshot,
  atsLimiters: Map<string, ReturnType<typeof pLimit>>
): Promise<AtsCandidateVerification[]> {
  const candidates = extractAtsCandidates({
    companyName: company.name,
    companyDomain: company.domain,
    page,
  })
  const ranked = [...candidates]
    .sort((a, b) => rankCandidate(b) - rankCandidate(a))
    .slice(0, MAX_VERIFICATIONS_PER_COMPANY)

  const verifications: AtsCandidateVerification[] = []
  for (const candidate of ranked) {
    // Per-ATS rate limiting
    const atsKey = candidate.atsType
    if (!atsLimiters.has(atsKey)) atsLimiters.set(atsKey, pLimit(PER_ATS_CONCURRENCY))
    const limiter = atsLimiters.get(atsKey)!

    const samePage = candidate.host === new URL(page.finalUrl ?? page.url).hostname.toLowerCase()
    const v = await limiter(() => {
      if (samePage) {
        return Promise.resolve(verifyAtsCandidate({
          candidate,
          companyName: company.name,
          companyDomain: company.domain,
          officialPageHtml: page.html,
          candidatePageHtml: page.html,
          candidateFinalUrl: page.finalUrl ?? page.url,
        }))
      }
      return verifyAtsCandidateUrl({
        candidate,
        companyName: company.name,
        companyDomain: company.domain,
        officialPageHtml: page.html,
        timeoutMs: PROBE_TIMEOUT_MS,
      })
    })
    verifications.push(v)
  }
  return verifications
}

// ── DB promotion ──────────────────────────────────────────────────────────────

async function promote(pool: Pool, company: CompanyRow, v: AtsCandidateVerification) {
  if (DRY_RUN) return
  const nextHarvest = v.status === "verified" ? "now()" : "now() + interval '8 hours'"
  const tier = v.status === "verified" ? "tier_2" : "tier_3"
  await pool.query(`
    UPDATE companies
       SET careers_url      = $1,
           direct_ats_url   = $1,
           ats_type         = $2,
           ats_identifier   = $3,
           is_active        = true,
           freshness_tier   = $4,
           discovered_via   = COALESCE(discovered_via, 'script:overnight-ats-discovery'),
           next_harvest_at  = ${nextHarvest},
           careers_discovery_attempted_at = now(),
           updated_at       = now()
     WHERE id = $5`,
    [v.candidate.candidateUrl, v.candidate.atsType, v.candidate.atsIdentifier, tier, company.id]
  )
}

async function markAttempted(pool: Pool, companyId: string) {
  if (DRY_RUN) return
  await pool.query(
    `UPDATE companies SET careers_discovery_attempted_at = now(), updated_at = now() WHERE id = $1`,
    [companyId]
  )
}

// ── Per-company processing ────────────────────────────────────────────────────

function detectJsonLd(html: string, careersUrl: string): { url: string; jobCount: number } | null {
  const blocks = extractJsonLdBlocks(html)
  const jobs = mapJsonLdToHarvestedJobs(blocks, { sourceAts: "jsonld", fallbackUrl: careersUrl })
  return jobs.length > 0 ? { url: careersUrl, jobCount: jobs.length } : null
}

async function promoteJsonLd(pool: Pool, company: CompanyRow, careersUrl: string, jobCount: number) {
  if (DRY_RUN) return
  console.log(`    [jsonld] ${company.name} — ${jobCount} JSON-LD jobs on ${careersUrl}`)
  await pool.query(`
    UPDATE companies
       SET careers_url     = $1,
           direct_ats_url  = $1,
           ats_type        = 'jsonld',
           ats_identifier  = $1,
           is_active       = true,
           discovered_via  = COALESCE(discovered_via, 'script:overnight-ats-discovery'),
           next_harvest_at = now(),
           freshness_tier  = 'tier_3',
           careers_discovery_attempted_at = now(),
           updated_at      = now()
     WHERE id = $2`,
    [careersUrl, company.id]
  )
}

// Wire ats_type = 'jsonld' for any company where we found a careers page but no
// standard ATS. The jsonld adapter will poll the page every harvest cycle — zero
// cost if empty, auto-picks up JSON-LD if they add it later. Also re-activates
// inactive companies so the harvester visits them.
async function wireDirectCrawl(pool: Pool, company: CompanyRow, careersUrl: string) {
  if (DRY_RUN) return
  await pool.query(`
    UPDATE companies
       SET careers_url     = $1,
           ats_type        = 'jsonld',
           ats_identifier  = $1,
           is_active       = true,
           discovered_via  = COALESCE(discovered_via, 'script:overnight-ats-discovery'),
           next_harvest_at = now() + interval '6 hours',
           freshness_tier  = 'tier_3',
           careers_discovery_attempted_at = now(),
           updated_at      = now()
     WHERE id = $2`,
    [careersUrl, company.id]
  )
}

async function processCompany(
  company: CompanyRow,
  pool: Pool,
  playwright: PlaywrightRenderer | null,
  atsLimiters: Map<string, ReturnType<typeof pLimit>>
): Promise<"promoted" | "jsonld" | "candidate" | "not_found"> {
  const urls = candidateUrls(company.domain, company.careers_url)

  for (const url of urls) {
    await new Promise(r => setTimeout(r, STAGGER_MS))
    const probe = await probeUrl(url)
    if (!probe.ok || !probe.html) continue

    const page: PageSnapshot = {
      url: probe.requestedUrl,
      finalUrl: probe.finalUrl,
      html: probe.html,
      redirectChain: probe.finalUrl !== probe.requestedUrl ? [probe.requestedUrl, probe.finalUrl] : [probe.requestedUrl],
    }

    // Tier 1: standard ATS detection (static)
    const verifications = await detectFromPage(company, page, atsLimiters)
    const best = verifications.filter(shouldPromote).sort((a, b) => b.confidence - a.confidence)[0]
    if (best) {
      await promote(pool, company, best)
      return "promoted"
    }

    // Tier 2: Playwright render → re-run standard ATS detection
    let renderedHtml: string | null = null
    if (playwright && !SKIP_PLAYWRIGHT) {
      renderedHtml = await playwright.render(probe.finalUrl).catch(() => null)
      if (renderedHtml) {
        const renderedPage: PageSnapshot = {
          url: probe.requestedUrl,
          finalUrl: probe.finalUrl,
          html: renderedHtml,
          redirectChain: [probe.finalUrl],
        }
        const pwVerifications = await detectFromPage(company, renderedPage, atsLimiters)
        const pwBest = pwVerifications.filter(shouldPromote).sort((a, b) => b.confidence - a.confidence)[0]
        if (pwBest) {
          await promote(pool, company, pwBest)
          return "promoted"
        }
      }
    }

    // Tier 3: JSON-LD fallback — check static HTML, then rendered HTML
    const htmlToCheck = renderedHtml ?? probe.html
    const jsonld = detectJsonLd(htmlToCheck, probe.finalUrl)
    if (jsonld) {
      await promoteJsonLd(pool, company, jsonld.url, jsonld.jobCount)
      return "jsonld"
    }

    // Found a careers page but no standard ATS and no JSON-LD — wire it for
    // direct jsonld polling so the harvester visits and picks up any future data.
    await wireDirectCrawl(pool, company, probe.finalUrl)
    if (verifications.length > 0) return "candidate"
    return "not_found"
  }

  // No careers page found at all — last-resort Playwright on most likely URL
  if (playwright && !SKIP_PLAYWRIGHT && urls.length > 0) {
    const tryUrl = urls.find(u => u.includes("/careers")) ?? urls[0]
    const rendered = await playwright.render(tryUrl).catch(() => null)
    if (rendered) {
      const page: PageSnapshot = { url: tryUrl, finalUrl: tryUrl, html: rendered, redirectChain: [tryUrl] }
      const verifications = await detectFromPage(company, page, atsLimiters)
      const best = verifications.filter(shouldPromote).sort((a, b) => b.confidence - a.confidence)[0]
      if (best) {
        await promote(pool, company, best)
        return "promoted"
      }
      const jsonld = detectJsonLd(rendered, tryUrl)
      if (jsonld) {
        await promoteJsonLd(pool, company, jsonld.url, jsonld.jobCount)
        return "jsonld"
      }
      if (verifications.length > 0) return "candidate"
    }
  }

  return "not_found"
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = getPool()
  const companies = await fetchCompanies(pool)
  const total = companies.length

  console.log(`[overnight-ats-discovery] ${total} companies to process`)
  console.log(`  concurrency=${CONCURRENCY}  playwright=${!SKIP_PLAYWRIGHT}  dry-run=${DRY_RUN}`)

  let playwright: PlaywrightRenderer | null = null
  if (!SKIP_PLAYWRIGHT) {
    console.log("  launching Playwright browser...")
    playwright = await createPlaywrightRenderer({ timeoutMs: PLAYWRIGHT_TIMEOUT_MS, extraDelayMs: 2_000 })
    console.log("  browser ready")
  }

  const limit = pLimit(CONCURRENCY)
  const atsLimiters = new Map<string, ReturnType<typeof pLimit>>()
  const stats = { promoted: 0, jsonld: 0, candidate: 0, not_found: 0, errors: 0 }
  let done = 0

  const shutdown = async () => {
    console.log("\n[overnight-ats-discovery] shutting down...")
    await playwright?.close()
    await pool.end()
    printStats()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  function printStats() {
    console.log(`\n[overnight-ats-discovery] done ${done}/${total}`)
    console.log(`  promoted=${stats.promoted}  jsonld=${stats.jsonld}  candidates=${stats.candidate}  not_found=${stats.not_found}  errors=${stats.errors}`)
  }

  await Promise.all(companies.map(company =>
    limit(async () => {
      try {
        await markAttempted(pool, company.id)
        const result = await processCompany(company, pool, playwright, atsLimiters)
        stats[result]++
      } catch (err) {
        stats.errors++
        console.error(`[error] ${company.name} (${company.domain}):`, (err as Error).message?.slice(0, 120))
      } finally {
        done++
        if (done % 50 === 0 || done === total) {
          const pct = ((done / total) * 100).toFixed(1)
          console.log(`  [${pct}%] ${done}/${total}  promoted=${stats.promoted}  jsonld=${stats.jsonld}  errors=${stats.errors}`)
        }
      }
    })
  ))

  await playwright?.close()
  await pool.end()
  printStats()
}

main().catch(err => {
  console.error("[overnight-ats-discovery] fatal:", err)
  process.exit(1)
})
