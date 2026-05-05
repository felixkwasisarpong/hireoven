import { crawlCareersPage } from "@/lib/crawler"
import { readFileSync, writeFileSync } from "fs"

process.on("uncaughtException", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("uncaughtException:", err)
})
process.on("unhandledRejection", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("unhandledRejection:", err)
})

type Row = {
  name: string
  input_url: string
  ats_type: string
  resolved_provider: string
  direct_url: string
  identifier: string
  source: string
}

function parseCsv(text: string): Row[] {
  const lines = text.split("\n").filter((l) => l.trim())
  const out: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"/)
    if (!m) continue
    out.push({
      name: m[1], input_url: m[2], ats_type: m[3], resolved_provider: m[4],
      direct_url: m[5], identifier: m[6], source: m[7],
    })
  }
  return out
}

async function withLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  const rows = parseCsv(readFileSync("scripts/output/ats-url-resolution.csv", "utf8"))
  const resolved = rows.filter((r) => r.direct_url && r.source !== "unresolved")
  console.log(`Crawling ${resolved.length} resolved URLs...\n`)

  const SUPPORTED = new Set(["greenhouse", "lever", "ashby", "workday", "smartrecruiters"])
  const crawlable = resolved.filter((r) => SUPPORTED.has(r.resolved_provider))
  console.log(`  ${crawlable.length} are on a directly-supported ATS\n`)

  let done = 0
  const started = Date.now()
  const results = await withLimit(crawlable, 4, async (r) => {
    let result
    try {
      result = await crawlCareersPage({
        companyId: r.name,
        companyName: r.name,
        atsType: r.resolved_provider,
        careersUrl: r.direct_url,
      })
    } catch (e) {
      result = null
    }
    done++
    if (done % 25 === 0) {
      console.log(`  ${done}/${crawlable.length} crawled (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    }
    return { row: r, jobCount: result?.jobs.length ?? 0, status: result?.outcomeStatus ?? "error", reason: result?.outcomeReason ?? null }
  })

  // Tally
  let totalJobs = 0
  let withJobs = 0
  const byProvider: Record<string, { count: number; jobs: number }> = {}
  for (const x of results) {
    if (x.jobCount > 0) {
      withJobs++
      totalJobs += x.jobCount
    }
    const p = x.row.resolved_provider
    byProvider[p] = byProvider[p] ?? { count: 0, jobs: 0 }
    byProvider[p].count++
    byProvider[p].jobs += x.jobCount
  }

  // Output
  const out = [`"name","input_url","direct_url","provider","status","reason","job_count"`]
  for (const x of results) {
    out.push(
      [x.row.name, x.row.input_url, x.row.direct_url, x.row.resolved_provider, x.status, x.reason ?? "", String(x.jobCount)]
        .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
  }
  writeFileSync("scripts/output/crawler-test-results.csv", out.join("\n"))

  console.log(`\nCrawled: ${results.length}`)
  console.log(`  with jobs: ${withJobs} (${((withJobs / results.length) * 100).toFixed(1)}%)`)
  console.log(`  total jobs pulled: ${totalJobs}`)
  for (const [p, v] of Object.entries(byProvider).sort((a, b) => b[1].jobs - a[1].jobs)) {
    console.log(`  ${p}: ${v.count} URLs → ${v.jobs} jobs`)
  }
  console.log(`\nWrote: scripts/output/crawler-test-results.csv`)
  process.exit(0)
}

main()
