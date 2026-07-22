/**
 * Re-detect the real ATS for companies stuck at ats_type='custom' (or with no
 * ats_type at all) — the same fix applied by hand to American Express (turned
 * out to be Oracle Cloud HCM, reached via a branded careers.* domain) and
 * Cantor Fitzgerald in this session.
 *
 * 'custom' is not a real adapter — the harvester's claim query can never pick
 * these companies up (see lib/harvester/worker.ts SUPPORTED_ATS_TYPES). The
 * existing discover-ats-sweep cron only slug-guesses across 5 name-based ATS
 * platforms (greenhouse/lever/ashby/smartrecruiters/eightfold), which can't
 * find enterprise platforms like Oracle Cloud/Workday/iCIMS/Avature — those
 * use per-tenant pod URLs that aren't derivable from a company name. This
 * script instead fetches each company's OWN careers_url, extracts every
 * embedded absolute link, and runs each one through the harvester's real
 * detectAdapter() — the exact function used at claim time — so a hit here is
 * guaranteed compatible with actual harvesting, not just a heuristic guess.
 *
 * Only WRITES when exactly one distinct adapter type is found across all
 * extracted links (ambiguous/zero matches are reported, never guessed at).
 *
 * Usage:
 *   npx tsx scripts/reclassify-custom-companies.ts                  # dry-run
 *   npx tsx scripts/reclassify-custom-companies.ts --limit=200
 *   npx tsx scripts/reclassify-custom-companies.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  return undefined
}

const EXECUTE = process.argv.includes("--execute")
const LIMIT = Number.parseInt(flag("limit") ?? "", 10) || 500
const CONCURRENCY = Math.max(1, Number.parseInt(flag("concurrency") ?? "", 10) || 12)
const FETCH_TIMEOUT_MS = Math.max(2000, Number.parseInt(flag("timeout-ms") ?? "", 10) || 9000)

const HREF_RE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi
const BARE_URL_RE = /https?:\/\/[^\s"'<>)]+/gi

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  direct_ats_url: string | null
}

type Finding = {
  company: CompanyRow
  matchedUrl: string
  atsType: string
  slug: string
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Static-asset paths are never a genuine per-company tenant link — matching
// them causes false positives (e.g. cdn.phenompeople.com, a shared asset CDN
// that phenom.ts's naive first-subdomain-label slug extraction would
// otherwise misread as a company-specific tenant, and the same wrong slug for
// every company that merely LINKS to that shared CDN).
const ASSET_EXTENSION_RE = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json)(\?|#|$)/i
// Adapters not yet trusted for auto-write: phenom's own header explicitly
// flags its JSON shape as unverified against a live endpoint, and its
// detectFromUrl treats ANY *.phenompeople.com subdomain as a tenant slug
// (including shared infra hosts like "cdn") — too noisy to write blind.
const UNTRUSTED_FOR_AUTOWRITE = new Set(["phenom"])

function extractCandidateUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(HREF_RE)) {
    if (ASSET_EXTENSION_RE.test(m[1])) continue
    try {
      found.add(new URL(m[1], baseUrl).toString())
    } catch {
      /* ignore malformed */
    }
  }
  for (const m of html.matchAll(BARE_URL_RE)) {
    if (ASSET_EXTENSION_RE.test(m[0])) continue
    found.add(m[0])
  }
  return [...found]
}

// URL-pattern detection alone has real false-positive edge cases beyond just
// phenom's shared-CDN bug — e.g. a Greenhouse embed/widget path can contain a
// path segment that isn't actually a company board token at all (found
// "content" as a "slug" from an Esri careers-page embed link; the real
// boards-api.greenhouse.io/v1/boards/content/jobs returns 404). Since we're
// about to bulk-write ats_type across many companies, actually RUN the
// candidate adapter's fetchJobs() and require it to return real jobs before
// trusting it — the same production code path the harvester itself uses, so
// a pass here is a real guarantee, not just a plausible-looking URL match.
// Verification budget is separate from (and much tighter than) the harvester's
// real per-company timeouts (oraclecloud alone gets 180s in production —
// see PER_COMPANY_TIMEOUT_BY_ADAPTER — because large tenants paginate deep).
// This script only needs "does the FIRST slice of pages return real jobs",
// not a full harvest, so a hard deadline here keeps one slow/misdetected
// candidate from stalling the whole batch — a timeout is treated the same as
// "couldn't verify" (rejected), never blocks.
const VERIFY_TIMEOUT_MS = Math.max(5000, Number.parseInt(flag("verify-timeout-ms") ?? "", 10) || 20000)

async function verifyMatchHasJobs(detection: NonNullable<ReturnType<typeof detectAdapter>>): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const result = await Promise.race([
      detection.adapter.fetchJobs({
        slug: detection.slug,
        ctx: { etag: null, lastModified: null, timeoutMs: FETCH_TIMEOUT_MS, signal: controller.signal },
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("verify_timeout")), { once: true })
      }),
    ])
    return result.jobs.length > 0
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function probeCompany(company: CompanyRow): Promise<Finding | "no-page" | "no-match" | "ambiguous"> {
  const targetUrl = company.direct_ats_url?.trim() || company.careers_url?.trim()
  if (!targetUrl) return "no-page"

  const html = await fetchHtml(targetUrl)
  if (!html) return "no-page"

  const candidates = extractCandidateUrls(html, targetUrl)
  const matches = new Map<string, Finding>()
  for (const url of candidates) {
    const detection = detectAdapter(url)
    if (!detection) continue
    if (!matches.has(detection.adapter.name)) {
      matches.set(detection.adapter.name, {
        company,
        matchedUrl: url,
        atsType: detection.adapter.name,
        slug: detection.slug,
      })
    }
  }

  if (matches.size === 0) return "no-match"
  if (matches.size > 1) return "ambiguous"

  const only = [...matches.values()][0]
  const detection = detectAdapter(only.matchedUrl)
  if (!detection || !(await verifyMatchHasJobs(detection))) return "no-match"
  return only
}

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, domain, careers_url, direct_ats_url
       FROM companies
      WHERE status = 'active' AND is_active = true
        AND (ats_type = 'custom' OR ats_type IS NULL)
        AND careers_url IS NOT NULL
      ORDER BY job_count DESC NULLS LAST
      LIMIT $1`,
    [LIMIT]
  )
  console.log(`probing ${rows.length} companies (limit=${LIMIT}, concurrency=${CONCURRENCY})`)

  const limiter = pLimit(CONCURRENCY)
  let done = 0
  const startedAt = Date.now()
  const outcomes = await Promise.all(
    rows.map((c) =>
      limiter(async () => {
        const outcome = await probeCompany(c)
        done += 1
        if (done % 25 === 0 || done === rows.length) {
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
          console.log(`  progress: ${done}/${rows.length} (${elapsedSec}s elapsed)`)
        }
        return outcome
      })
    )
  )

  const findings: Finding[] = []
  let noPage = 0
  let noMatch = 0
  let ambiguous = 0
  for (const o of outcomes) {
    if (o === "no-page") noPage += 1
    else if (o === "no-match") noMatch += 1
    else if (o === "ambiguous") ambiguous += 1
    else findings.push(o)
  }

  console.log(`\nresults: ${findings.length} confident matches, ${noMatch} no-match, ${ambiguous} ambiguous, ${noPage} unreachable\n`)

  const byType = new Map<string, number>()
  for (const f of findings) byType.set(f.atsType, (byType.get(f.atsType) ?? 0) + 1)
  console.log("by detected ATS type:")
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(16)} ${n}`)
  }

  console.log("\nsample matches:")
  for (const f of findings.slice(0, 25)) {
    console.log(`  ${f.company.name.slice(0, 35).padEnd(35)} custom -> ${f.atsType.padEnd(14)} slug=${f.slug} (via ${f.matchedUrl.slice(0, 70)})`)
  }

  const autoWritable = findings.filter((f) => !UNTRUSTED_FOR_AUTOWRITE.has(f.atsType))
  const untrusted = findings.filter((f) => UNTRUSTED_FOR_AUTOWRITE.has(f.atsType))
  if (untrusted.length > 0) {
    console.log(`\n${untrusted.length} matches are on an untrusted-for-autowrite adapter (never written, review manually):`)
    for (const f of untrusted) {
      console.log(`   ${f.company.name.slice(0, 40).padEnd(40)} ${f.atsType}:${f.slug}`)
    }
  }

  if (!EXECUTE) {
    console.log("\ndry-run — pass --execute to write ats_type/ats_identifier for confident, trusted matches.")
    await pool.end()
    return
  }

  let written = 0
  const alreadyEnrolledElsewhere: Array<{ name: string; id: string; atsType: string; slug: string }> = []
  for (const f of autoWritable) {
    try {
      await pool.query(
        `UPDATE companies
            SET ats_type = $2,
                ats_identifier = $3,
                consecutive_empty_crawls = 0,
                next_harvest_at = now(),
                notes = COALESCE(notes || E'\n', '') || $4,
                updated_at = now()
          WHERE id = $1`,
        [
          f.company.id,
          f.atsType,
          f.slug,
          `${new Date().toISOString().slice(0, 10)}: reclassified from 'custom' to '${f.atsType}' — real ATS found via embedded link ${f.matchedUrl} on ${f.company.careers_url}`,
        ]
      )
      written += 1
    } catch (e) {
      // uq_companies_ats_pair_active — this exact (ats_type, ats_identifier) is
      // already enrolled under a DIFFERENT company row (the American Express /
      // Cantor Fitzgerald pattern: a discovery sweep already found the real
      // tenant under a garbage auto-generated name). Worth a manual merge, not
      // a silent failure — surface it distinctly.
      if ((e as Error).message.includes("uq_companies_ats_pair_active")) {
        alreadyEnrolledElsewhere.push({ name: f.company.name, id: f.company.id, atsType: f.atsType, slug: f.slug })
      } else {
        console.error(`  failed to update ${f.company.name}: ${(e as Error).message}`)
      }
    }
  }
  console.log(`\ndone. reclassified ${written}/${autoWritable.length} companies.`)
  if (alreadyEnrolledElsewhere.length > 0) {
    console.log(`\n${alreadyEnrolledElsewhere.length} matches are already enrolled under a DIFFERENT company id — needs a manual merge (same pattern as American Express / Cantor Fitzgerald):`)
    for (const dup of alreadyEnrolledElsewhere) {
      console.log(`   ${dup.name.slice(0, 40).padEnd(40)} wants ${dup.atsType}:${dup.slug} (own id ${dup.id})`)
    }
  }
  await pool.end()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
