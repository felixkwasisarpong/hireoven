/**
 * For each company with a `bad_url` (404) careers URL, attempt to discover the
 * real careers page by:
 *   1. Fetching the company's homepage HTML.
 *   2. Extracting anchor hrefs that mention careers/jobs.
 *   3. Following each candidate (with redirects) and checking the final URL.
 *   4. If the final URL or its embedded scripts match a known ATS host
 *      (Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, BambooHR),
 *      record the proposed new careers_url + ats_type.
 *
 * Pure read-only: writes proposals to a CSV for human review. No DB writes.
 *
 * Usage:
 *   npx tsx scripts/discover-dead-url-fixes.ts \
 *     --input=data/zero-jobs-dead-urls.csv \
 *     --output=data/zero-jobs-dead-url-proposals.csv
 *   npx tsx scripts/discover-dead-url-fixes.ts --concurrency=4 --limit=20
 */

import fs from "node:fs"
import { parse } from "csv-parse/sync"
import pLimit from "p-limit"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

// Node 20.11 undici can throw "Controller is already closed" from internals
// after a fetch resolves. Suppress only that specific unhandled rejection.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("Controller is already closed")) return
  console.error("unhandledRejection:", reason)
  process.exit(1)
})

const inputArg = process.argv.find((a) => a.startsWith("--input="))?.split("=")[1] ??
  "data/zero-jobs-dead-urls.csv"
const outputArg = process.argv.find((a) => a.startsWith("--output="))?.split("=")[1] ??
  "data/zero-jobs-dead-url-proposals.csv"
const concurrency = Math.max(1, Number.parseInt(
  process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "4",
  10
))
const limitArg = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]
const rowLimit = limitArg ? Math.max(1, Number.parseInt(limitArg, 10)) : null

const TIMEOUT_MS = 12_000
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

type CsvRow = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  jobs_found: string
}

type Proposal = {
  id: string
  name: string
  domain: string
  old_url: string
  old_ats: string
  new_url: string | null
  new_ats: string | null
  confidence: "high" | "medium" | "none"
  reason: string
}

async function fetchText(url: string): Promise<{ ok: boolean; finalUrl: string; html: string | null; status: number | null }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    const finalUrl = res.url || url
    if (!res.ok) {
      try { await res.body?.cancel() } catch {}
      return { ok: false, finalUrl, html: null, status: res.status }
    }
    const html = await res.text()
    return { ok: true, finalUrl, html, status: res.status }
  } catch {
    return { ok: false, finalUrl: url, html: null, status: null }
  } finally {
    clearTimeout(timer)
  }
}

function extractCareerLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  // Match <a ... href="..."> where the href OR the surrounding tag/text mentions careers/jobs.
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*"([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1]
    const text = match[2].replace(/<[^>]+>/g, " ").trim()
    const candidate = `${href} ${text}`.toLowerCase()
    if (!/(career|job|hiring|join.us|work.with.us|positions?|opening)/i.test(candidate)) continue
    try {
      const resolved = new URL(href, baseUrl).toString()
      out.add(resolved)
    } catch {}
  }
  return [...out]
}

const ATS_HOST_HINTS: Array<{ pattern: RegExp; ats: string }> = [
  { pattern: /myworkdayjobs\.com/i, ats: "workday" },
  { pattern: /boards\.greenhouse\.io/i, ats: "greenhouse" },
  { pattern: /job-boards\.greenhouse\.io/i, ats: "greenhouse" },
  { pattern: /\.greenhouse\.io/i, ats: "greenhouse" },
  { pattern: /jobs\.lever\.co/i, ats: "lever" },
  { pattern: /jobs\.ashbyhq\.com/i, ats: "ashby" },
  { pattern: /\.icims\.com/i, ats: "icims" },
  { pattern: /jobs\.smartrecruiters\.com/i, ats: "smartrecruiters" },
  { pattern: /\.bamboohr\.com/i, ats: "bamboohr" },
  { pattern: /successfactors\.com|sapsf\.com/i, ats: "successfactors" },
  { pattern: /taleo\.net/i, ats: "taleo" },
  { pattern: /workable\.com/i, ats: "workable" },
  { pattern: /csod\.com/i, ats: "csod" },
]

function detectAtsFromUrlOrHost(url: string): { ats: string | null; matched: string | null } {
  const direct = detectAtsFromUrl(url)
  if (direct) return { ats: direct.atsType, matched: direct.atsType }
  for (const hint of ATS_HOST_HINTS) {
    if (hint.pattern.test(url)) return { ats: hint.ats, matched: hint.pattern.source }
  }
  return { ats: null, matched: null }
}

function detectAtsFromHtml(html: string): { ats: string | null; sampleUrl: string | null } {
  // Find embedded ATS host references in HTML (script/iframe src etc).
  for (const hint of ATS_HOST_HINTS) {
    const re = new RegExp(`https?:\\/\\/[^"'\\s>]*${hint.pattern.source}[^"'\\s>]*`, "i")
    const m = html.match(re)
    if (m) return { ats: hint.ats, sampleUrl: m[0] }
  }
  return { ats: null, sampleUrl: null }
}

async function discover(row: CsvRow): Promise<Proposal> {
  const proposal: Proposal = {
    id: row.id,
    name: row.name,
    domain: row.domain,
    old_url: row.careers_url,
    old_ats: row.ats_type,
    new_url: null,
    new_ats: null,
    confidence: "none",
    reason: "no_candidates",
  }

  if (!row.domain?.trim()) {
    proposal.reason = "missing_domain"
    return proposal
  }

  const homeCandidates = [`https://${row.domain}`, `https://www.${row.domain}`]
  let homepage: { ok: boolean; finalUrl: string; html: string | null; status: number | null } | null = null
  for (const u of homeCandidates) {
    const r = await fetchText(u)
    if (r.ok && r.html) { homepage = r; break }
    if (r.status === 401 || r.status === 403) { homepage = r; break }
  }

  if (!homepage?.ok || !homepage.html) {
    proposal.reason = `homepage_unreachable_${homepage?.status ?? "error"}`
    return proposal
  }

  // 1. Check if homepage itself embeds an ATS link (common for SPAs that ship Workday/Greenhouse iframes).
  const embeddedAts = detectAtsFromHtml(homepage.html)
  if (embeddedAts.ats && embeddedAts.sampleUrl) {
    proposal.new_url = embeddedAts.sampleUrl
    proposal.new_ats = embeddedAts.ats
    proposal.confidence = "high"
    proposal.reason = "homepage_embeds_ats"
    return proposal
  }

  // 2. Extract careers/jobs anchors and follow them.
  const links = extractCareerLinks(homepage.html, homepage.finalUrl)
  if (links.length === 0) {
    proposal.reason = "no_career_links_on_homepage"
    return proposal
  }

  // Try the first 5 candidates; favor ones with "career" or "job" in path.
  const ranked = links
    .slice()
    .sort((a, b) => {
      const score = (u: string) => {
        const lower = u.toLowerCase()
        let s = 0
        if (/\/careers?\b/.test(lower)) s += 4
        if (/\/jobs?\b/.test(lower)) s += 3
        if (/career|job|hiring/.test(lower)) s += 1
        return -s
      }
      return score(a) - score(b)
    })
    .slice(0, 5)

  let bestProposal: Proposal | null = null
  for (const candidate of ranked) {
    // Detect from URL alone (e.g. direct workday tenant link)
    const direct = detectAtsFromUrlOrHost(candidate)
    if (direct.ats) {
      bestProposal = {
        ...proposal,
        new_url: candidate,
        new_ats: direct.ats,
        confidence: "high",
        reason: `link_url_matches_${direct.ats}`,
      }
      break
    }

    // Otherwise fetch and look at final URL + embedded ATS markers.
    const r = await fetchText(candidate)
    if (!r.ok || !r.html) continue

    const finalAts = detectAtsFromUrlOrHost(r.finalUrl)
    if (finalAts.ats) {
      bestProposal = {
        ...proposal,
        new_url: r.finalUrl,
        new_ats: finalAts.ats,
        confidence: "high",
        reason: `redirect_target_${finalAts.ats}`,
      }
      break
    }

    const htmlAts = detectAtsFromHtml(r.html)
    if (htmlAts.ats && htmlAts.sampleUrl) {
      bestProposal = {
        ...proposal,
        new_url: htmlAts.sampleUrl,
        new_ats: htmlAts.ats,
        confidence: "high",
        reason: `careers_page_embeds_${htmlAts.ats}`,
      }
      break
    }

    // Medium-confidence fallback: the link itself looks like a working careers page
    // (no ATS detected) — record it for manual review.
    if (!bestProposal && /\/(careers?|jobs?|work|hiring|opportunit\w*)\b/i.test(r.finalUrl)) {
      bestProposal = {
        ...proposal,
        new_url: r.finalUrl,
        new_ats: null,
        confidence: "medium",
        reason: "careers_page_no_ats_detected",
      }
    }
  }

  return bestProposal ?? proposal
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const csvText = fs.readFileSync(inputArg, "utf-8")
  const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as CsvRow[]
  const targets = rowLimit ? rows.slice(0, rowLimit) : rows

  console.log(`[discover] processing ${targets.length} rows (concurrency=${concurrency})`)

  const gate = pLimit(concurrency)
  const proposals: Proposal[] = []
  let done = 0

  await Promise.all(
    targets.map((row) =>
      gate(async () => {
        const p = await discover(row)
        proposals.push(p)
        done += 1
        if (done % 5 === 0) {
          process.stderr.write(`  ${done}/${targets.length}\r`)
        }
      })
    )
  )

  process.stderr.write("\n")

  const header = [
    "id", "name", "domain", "old_url", "old_ats",
    "new_url", "new_ats", "confidence", "reason",
  ]
  const out = [header.map(csvEscape).join(",")]
  for (const p of proposals) {
    out.push([
      p.id, p.name, p.domain, p.old_url, p.old_ats,
      p.new_url ?? "", p.new_ats ?? "", p.confidence, p.reason,
    ].map(csvEscape).join(","))
  }
  fs.writeFileSync(outputArg, out.join("\n") + "\n", "utf-8")

  // Summary
  const byConfidence = new Map<string, number>()
  const byReason = new Map<string, number>()
  for (const p of proposals) {
    byConfidence.set(p.confidence, (byConfidence.get(p.confidence) ?? 0) + 1)
    byReason.set(p.reason, (byReason.get(p.reason) ?? 0) + 1)
  }

  console.log(`\n[discover] wrote ${outputArg}`)
  console.log("By confidence:")
  for (const [c, n] of [...byConfidence.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(10)} ${n}`)
  }
  console.log("\nTop reasons:")
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${r.padEnd(36)} ${n}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
