import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"
import { detectAtsFromHtml } from "../lib/companies/ats-signatures"
import { discoverCareersUrl, type DiscoveryProbe } from "../lib/companies/careers-url-discovery"

type E = { name: string; domain: string | null; website: string | null; external_careers_url: string | null }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36"
async function fetchHtml(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number | null; html: string | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html,*/*;q=0.7" } })
    let html: string | null = null
    try { html = await res.text() } catch {}
    return { ok: res.ok, status: res.status, html }
  } catch { return { ok: false, status: null, html: null } } finally { clearTimeout(t) }
}
const probe: DiscoveryProbe = async ({ url }) => fetchHtml(url)

async function main() {
  const rows = fs.readFileSync("data/builtinsf-enriched.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as E)
  const withDomain = rows.filter((r) => r.domain) as Required<E>[]

  const out: {
    name: string
    domain: string
    careers_url: string
    discovery_confidence: string
    ats_from_url: string | null
    ats_from_html: string | null
    ats_html_confidence: string | null
    ats: string | null
    ats_source: "url" | "html" | null
  }[] = []
  let done = 0
  async function worker(queue: Required<E>[]) {
    while (queue.length) {
      const r = queue.shift()!
      try {
        const d = await discoverCareersUrl({ domain: r.domain, probe })
        const detUrl = detectAtsFromUrl(d.url)
        // Fetch the careers page HTML and scan it for embedded ATS signatures
        // (greenhouse/lever/ashby/workday/etc. iframes or links).
        let detHtml: { atsType: string; confidence: string } | null = null
        if (!detUrl) {
          const page = await fetchHtml(d.url)
          if (page.html) {
            const sig = detectAtsFromHtml({ url: d.url, html: page.html })
            if (sig) detHtml = { atsType: sig.atsType, confidence: sig.confidence }
          }
        }
        const ats = detUrl?.atsType ?? detHtml?.atsType ?? null
        const ats_source = detUrl ? "url" : detHtml ? "html" : null
        out.push({
          name: r.name,
          domain: r.domain,
          careers_url: d.url,
          discovery_confidence: d.confidence,
          ats_from_url: detUrl?.atsType ?? null,
          ats_from_html: detHtml?.atsType ?? null,
          ats_html_confidence: detHtml?.confidence ?? null,
          ats,
          ats_source,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        process.stderr.write(`  ERR ${r.domain}: ${msg}\n`)
        out.push({
          name: r.name,
          domain: r.domain,
          careers_url: `https://${r.domain}/careers`,
          discovery_confidence: "error",
          ats_from_url: null,
          ats_from_html: null,
          ats_html_confidence: null,
          ats: null,
          ats_source: null,
        })
      }
      done++
      if (done % 10 === 0) process.stderr.write(`  ${done}/${withDomain.length}\n`)
    }
  }
  const queue = [...withDomain]
  await Promise.all(Array.from({ length: 8 }, () => worker(queue)))

  const ats = out.filter((o) => o.ats)
  const nonAts = out.filter((o) => !o.ats)
  const counts: Record<string, number> = {}
  for (const o of ats) counts[o.ats!] = (counts[o.ats!] ?? 0) + 1
  const bySource = {
    url: ats.filter((o) => o.ats_source === "url").length,
    html: ats.filter((o) => o.ats_source === "html").length,
  }

  console.log("\n=== ATS detection over SF companies with domain ===")
  console.log("Totals:", { total: out.length, ats: ats.length, nonAts: nonAts.length })
  console.log("ATS by type:", counts)
  console.log("ATS by source:", bySource)
  console.log("\nATS hits (first 30):")
  for (const o of ats.slice(0, 30)) console.log(`  [${o.ats!.padEnd(16)}] (${o.ats_source}) ${o.name.padEnd(26)} ${o.careers_url}`)
  console.log("\nNon-ATS / direct careers (first 20):")
  for (const o of nonAts.slice(0, 20)) console.log(`  ${o.name.padEnd(28)} ${o.careers_url}  (conf=${o.discovery_confidence})`)

  fs.writeFileSync("data/builtinsf-ats-report.json", JSON.stringify(out, null, 2))
  console.log("\nFull report → data/builtinsf-ats-report.json")
}

main().catch((e) => { console.error(e); process.exit(1) })
