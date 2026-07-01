/**
 * Enroll companies from two public curated job lists by extracting the ATS
 * board URLs they contain and running each through the harvester's own
 * `detectAdapter` (→ ats_type + slug) and `enrollTenantAsCompany` (→ dedup +
 * queue). Same safe path as the jobhive import: offline dry-run by default,
 * nothing written unless --execute.
 *
 * Sources:
 *   - outscal/OpenJobs   data/companies_v2.json  (12k companies, `ats_links[]`)
 *   - tonisives/defi-jobs-list  README.md         (markdown of ATS links)
 *
 *   npx tsx tools/ingest-external-lists.ts                 # offline dry-run
 *   npx tsx tools/ingest-external-lists.ts --execute       # WRITE (enroll)
 *   npx tsx tools/ingest-external-lists.ts --source openjobs --limit 50
 */

import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const OPENJOBS_URL =
  "https://raw.githubusercontent.com/outscal/OpenJobs/main/data/companies_v2.json"
const DEFI_URL =
  "https://raw.githubusercontent.com/tonisives/defi-jobs-list/main/README.md"

type Candidate = {
  url: string
  nameGuess?: string
  domainGuess?: string
  source: "openjobs" | "defi"
}

type Normalized = {
  atsType: AtsName
  atsIdentifier: string
  careersUrl: string
  name?: string
  domainGuess?: string
  source: string
}

function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    execute: argv.includes("--execute"),
    only: get("--source") ?? null, // "openjobs" | "defi"
    limit: get("--limit") ? Number.parseInt(get("--limit")!, 10) : null,
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  return res.text()
}

/** apex-ish domain from a website URL (drop scheme, leading www). */
function domainOf(website: string | undefined): string | undefined {
  if (!website) return undefined
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase() || undefined
  } catch {
    return undefined
  }
}

type OpenJobsCompany = { name?: string; website?: string; ats_links?: string[] }

async function loadOpenjobs(): Promise<Candidate[]> {
  const data = JSON.parse(await fetchText(OPENJOBS_URL)) as OpenJobsCompany[]
  const out: Candidate[] = []
  for (const c of data) {
    const domainGuess = domainOf(c.website)
    for (const url of c.ats_links ?? []) {
      out.push({ url, nameGuess: c.name?.trim(), domainGuess, source: "openjobs" })
    }
  }
  return out
}

async function loadDefi(): Promise<Candidate[]> {
  const md = await fetchText(DEFI_URL)
  // Pull every http(s) URL out of the markdown; detectAdapter filters to real
  // ATS boards. Company name isn't reliably adjacent (many rows are [url](url)),
  // so we let the slug stand in.
  const urls = md.match(/https?:\/\/[^\s)\]]+/g) ?? []
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const raw of urls) {
    const url = raw.replace(/[.,)]+$/, "")
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, source: "defi" })
  }
  return out
}

function normalize(cand: Candidate): Normalized | null {
  const detected = detectAdapter(cand.url)
  if (!detected) return null
  const atsType = detected.adapter.name
  const atsIdentifier = detected.slug
  if (!atsIdentifier) return null
  const careersUrl = canonicalCareersUrl(atsType, atsIdentifier) ?? cand.url
  return {
    atsType,
    atsIdentifier,
    careersUrl,
    name: cand.nameGuess,
    domainGuess: cand.domainGuess,
    source: cand.source,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const candidates: Candidate[] = []
  if (args.only !== "defi") candidates.push(...(await loadOpenjobs()))
  if (args.only !== "openjobs") candidates.push(...(await loadDefi()))

  // Normalize + dedup by (atsType, atsIdentifier). Prefer a candidate that
  // carries a domain guess (OpenJobs) over a bare one (defi).
  const byKey = new Map<string, Normalized>()
  const skip = { unrecognized: 0, emptySlug: 0 }
  let considered = 0
  for (const cand of candidates) {
    if (args.limit && considered >= args.limit) break
    considered++
    const n = normalize(cand)
    if (!n) {
      skip.unrecognized++
      continue
    }
    const key = `${n.atsType}:${n.atsIdentifier}`
    const existing = byKey.get(key)
    if (!existing || (!existing.domainGuess && n.domainGuess)) byKey.set(key, n)
  }

  const rows = [...byKey.values()]
  const byAts = new Map<string, number>()
  const bySource = new Map<string, number>()
  for (const r of rows) {
    byAts.set(r.atsType, (byAts.get(r.atsType) ?? 0) + 1)
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
  }

  console.log(`\n=== External job-list ingest (${args.execute ? "EXECUTE" : "DRY RUN"}) ===\n`)
  console.log(`Candidate ATS URLs scanned: ${candidates.length}`)
  console.log(`  skipped (not a recognized ATS): ${skip.unrecognized}`)
  console.log(`Unique (ats, slug) boards to enroll: ${rows.length}`)
  console.log(`  by source: ${[...bySource].map(([k, v]) => `${k}=${v}`).join(", ")}`)
  console.log("  by ATS:")
  for (const [ats, n] of [...byAts].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ats.padEnd(16)} ${n}`)
  }
  console.log("\n  sample:")
  for (const r of rows.slice(0, 6)) {
    console.log(`    [${r.atsType}] ${r.name ?? r.atsIdentifier} → id="${r.atsIdentifier}" (${r.source})`)
  }
  console.log()

  if (!args.execute) {
    console.log("Dry run only — no database touched. Re-run with --execute to enroll.")
    return
  }

  const { getPostgresPool } = await import("@/lib/postgres/server")
  const { enrollTenantAsCompany } = await import("@/lib/discovery/enroll-tenant-as-company")
  const pool = getPostgresPool()
  console.log("!!! EXECUTE — enrolling. (df -h the web box first for big runs.) !!!\n")

  let created = 0
  let linked = 0
  let failed = 0
  const CONCURRENCY = Math.max(1, Number.parseInt(process.env.INGEST_CONCURRENCY ?? "16", 10))
  let idx = 0
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++]
      try {
        const res = await enrollTenantAsCompany(pool, {
          atsType: r.atsType,
          atsIdentifier: r.atsIdentifier,
          confidence: 65,
          sourceType: `list:${r.source}`,
          sourceUrl: r.careersUrl,
          companyNameGuess: r.name,
          domainGuess: r.domainGuess,
        })
        res.created ? created++ : linked++
      } catch (e) {
        failed++
        if (failed <= 10) console.error(`  fail ${r.atsType}/${r.atsIdentifier}: ${(e as Error).message}`)
      }
      if ((created + linked + failed) % 500 === 0) {
        console.log(`  progress: ${created} created, ${linked} linked, ${failed} failed`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\nDone: ${created} created, ${linked} linked/updated, ${failed} failed`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
