import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { F2000_US_GAP_FILL_ROWS } from "./data/company-seeds-f2000-us"

const PLACEHOLDER = new Set(["REMOVED-PLACEHOLDER", "REMOVED-PLACEHOLDER-2"])
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const seen = new Set<string>()
const rows = F2000_US_GAP_FILL_ROWS
  .filter(([, d]) => !PLACEHOLDER.has(d))
  .filter(([, d]) => {
    if (seen.has(d)) return false
    seen.add(d)
    return true
  })

type Probe = {
  name: string
  domain: string
  url: string
  status: number | null
  ok: boolean
  redirected: boolean
  finalUrl: string | null
  bodyLen: number
  hasCareerSignal: boolean
  err?: string
}

async function probe(url: string, timeoutMs = 12000): Promise<Omit<Probe, "name" | "domain" | "url">> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    let body = ""
    try {
      body = await res.text()
    } catch {}
    const lower = body.toLowerCase()
    const hasCareerSignal =
      /(job|career|position|opening|opportunit|requisition|vacanc|hiring|apply now)/i.test(lower)
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      redirected: res.url !== url,
      bodyLen: body.length,
      hasCareerSignal,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      status: null,
      finalUrl: null,
      redirected: false,
      bodyLen: 0,
      hasCareerSignal: false,
      err: msg,
    }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  console.log(`Probing ${rows.length} careers URLs...`)
  const concurrency = 16
  const queue = [...rows]
  const results: Probe[] = []
  let done = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) break
        const [name, domain, careers] = next
        const r = await probe(careers)
        results.push({ name, domain, url: careers, ...r })
        done++
        if (done % 50 === 0) console.log(`  ${done}/${rows.length}`)
      }
    })
  )

  const total = results.length
  const ok200 = results.filter((r) => r.status === 200).length
  const okOther2xx3xx = results.filter((r) => r.ok && r.status !== 200).length
  const notFound = results.filter((r) => r.status === 404).length
  const other4xx = results.filter(
    (r) => !r.ok && r.status !== 404 && r.status !== null && r.status < 500
  ).length
  const fivexx = results.filter((r) => r.status && r.status >= 500).length
  const networkErr = results.filter((r) => r.status === null).length
  const okAndSignal = results.filter((r) => r.ok && r.hasCareerSignal).length
  const okNoSignal = results.filter((r) => r.ok && !r.hasCareerSignal).length

  console.log(`\n=== Careers-URL probe summary (n=${total}) ===`)
  console.log(`  HTTP 200 ........... ${ok200}`)
  console.log(`  Other 2xx/3xx ok ... ${okOther2xx3xx}`)
  console.log(`  HTTP 404 ........... ${notFound}`)
  console.log(`  Other 4xx .......... ${other4xx}`)
  console.log(`  5xx ................ ${fivexx}`)
  console.log(`  Network/timeout .... ${networkErr}`)
  console.log(`  ────`)
  console.log(`  ok + career signal . ${okAndSignal}   (likely real careers page)`)
  console.log(`  ok + no signal ..... ${okNoSignal}   (could be SPA/JS-rendered, manual check)`)

  console.log(`\n--- All failures ---`)
  for (const r of results
    .filter((x) => !x.ok)
    .sort((a, b) => a.domain.localeCompare(b.domain))) {
    console.log(`  ${String(r.status ?? r.err ?? "ERR").padEnd(10)} ${r.url}`)
  }

  console.log(`\n--- Suspicious: ok but no career signal (first 30) ---`)
  for (const r of results.filter((x) => x.ok && !x.hasCareerSignal).slice(0, 30)) {
    console.log(`  ${String(r.status).padEnd(4)} body=${r.bodyLen.toString().padEnd(8)} ${r.url}`)
  }

  const fs = await import("fs")
  fs.writeFileSync("/tmp/seed-probe.json", JSON.stringify(results, null, 2))
  console.log(`\nFull report: /tmp/seed-probe.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
