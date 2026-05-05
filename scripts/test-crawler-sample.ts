import { crawlCareersPage } from "@/lib/crawler"

const samples: Array<{ name: string; url: string; atsType: string }> = [
  { name: "1Password", url: "https://1password.com/careers", atsType: "greenhouse" },
  { name: "Lever", url: "https://jobs.lever.co/lever", atsType: "lever" },
  { name: "1Password (Ashby)", url: "https://jobs.ashbyhq.com/1password", atsType: "ashby" },
  { name: "3M", url: "https://careers.3m.com", atsType: "workday" },
  { name: "7-Eleven", url: "https://careers.7-eleven.com", atsType: "icims" },
]

async function main() {
  console.log(`Running crawler against ${samples.length} live URLs...\n`)
  for (const s of samples) {
    const started = Date.now()
    try {
      const result = await crawlCareersPage({
        companyId: "test",
        companyName: s.name,
        atsType: s.atsType,
        careersUrl: s.url,
      })
      const elapsed = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`[${s.atsType.padEnd(15)}] ${s.name}`)
      console.log(`  url:    ${s.url}`)
      console.log(`  status: ${result.outcomeStatus}  reason: ${result.outcomeReason ?? "—"}`)
      console.log(`  jobs:   ${result.jobs.length}  (${elapsed}s)`)
      if (result.jobs.length > 0) {
        const sample = result.jobs.slice(0, 2)
        for (const j of sample) console.log(`    · ${j.title}${j.location ? ` — ${j.location}` : ""}`)
      }
      console.log()
    } catch (err: unknown) {
      console.log(`[${s.atsType}] ${s.name} → ERROR ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
  process.exit(0)
}

main()
