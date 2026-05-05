import { resolveDirectAtsUrl, type RenderHtml } from "@/lib/companies/ats-url-resolver"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import type { Browser } from "playwright"

// Swallow undici stream-controller hiccups so they don't crash the run.
process.on("uncaughtException", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("uncaughtException:", err)
})
process.on("unhandledRejection", (err) => {
  if (err instanceof TypeError && /Controller is already closed/.test(err.message)) return
  console.error("unhandledRejection:", err)
})

type Row = { name: string; careers_url: string; ats_type: string; status: string; notes: string }

function parseCsv(text: string): Row[] {
  const lines = text.split("\n").filter((l) => l.trim())
  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"/)
    if (!m) continue
    rows.push({ name: m[1], careers_url: m[2], ats_type: m[3], status: m[4], notes: m[5] })
  }
  return rows
}

function csvField(s: string | null | undefined): string {
  return `"${(s ?? "").replace(/"/g, '""')}"`
}

const CONCURRENCY = 6
const SUPPORTED_ATS = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workday"])
const PLAYWRIGHT_TIMEOUT_MS = 18_000

async function makePlaywrightRenderer(): Promise<{ render: RenderHtml; close: () => Promise<void> }> {
  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({ headless: true })
  const render: RenderHtml = async (url) => {
    let context, page
    try {
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
      })
      page = await context.newPage()
      await page.route("**/*", (route) => {
        const t = route.request().resourceType()
        if (t === "image" || t === "media" || t === "font") return route.abort()
        return route.continue()
      })
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PLAYWRIGHT_TIMEOUT_MS })
      // Give SPAs a moment to inject ATS links after hydration.
      try { await page.waitForLoadState("networkidle", { timeout: 4000 }) } catch {}
      return await page.content()
    } catch {
      return null
    } finally {
      try { await page?.close() } catch {}
      try { await context?.close() } catch {}
    }
  }
  return { render, close: async () => { try { await browser.close() } catch {} } }
}

async function withLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  const csvPath = resolve("scripts/output/careers-cleaned-verified-crawl-ready-2026-04-30.csv")
  const text = readFileSync(csvPath, "utf8")
  const rows = parseCsv(text)
  console.log(`Loaded ${rows.length} verified rows`)

  // Filter to supported ATS only — these are the rows we want to resolve.
  const candidates = rows.filter((r) => SUPPORTED_ATS.has(r.ats_type.toLowerCase()))
  console.log(`Resolving ${candidates.length} supported-ATS rows...\n`)

  // Phase A — static fetch + slug probe (no Playwright, fast)
  console.log("Phase A: static fetch + slug probe...")
  const phaseAStart = Date.now()
  let aDone = 0
  const phaseA = await withLimit(candidates, CONCURRENCY, async (r) => {
    let resolved
    try {
      resolved = await resolveDirectAtsUrl(r.careers_url, {
        atsType: r.ats_type,
        companyName: r.name,
      })
    } catch {
      resolved = null
    }
    aDone++
    if (aDone % 50 === 0) {
      console.log(`  ${aDone}/${candidates.length} (${((Date.now() - phaseAStart) / 1000).toFixed(1)}s)`)
    }
    return { row: r, resolved }
  })
  const phaseAElapsed = ((Date.now() - phaseAStart) / 1000).toFixed(1)
  const stillUnresolved = phaseA.filter((p) => !p.resolved)
  console.log(`\nPhase A done in ${phaseAElapsed}s: ${candidates.length - stillUnresolved.length} resolved, ${stillUnresolved.length} unresolved`)

  // Phase B — Playwright on the long tail (only what static + slug probe missed)
  console.log(`\nPhase B: Playwright on ${stillUnresolved.length} remaining...`)
  const renderer = await makePlaywrightRenderer()
  const phaseBStart = Date.now()
  let bDone = 0
  const phaseB = await withLimit(stillUnresolved, 3, async (entry) => {
    let resolved
    try {
      resolved = await resolveDirectAtsUrl(entry.row.careers_url, {
        atsType: entry.row.ats_type,
        companyName: entry.row.name,
        renderHtml: renderer.render,
      })
    } catch {
      resolved = null
    }
    bDone++
    if (bDone % 20 === 0) {
      console.log(`  ${bDone}/${stillUnresolved.length} (${((Date.now() - phaseBStart) / 1000).toFixed(1)}s)`)
    }
    return { row: entry.row, resolved }
  })
  await renderer.close()
  const phaseBElapsed = ((Date.now() - phaseBStart) / 1000).toFixed(1)
  const phaseBNew = phaseB.filter((b) => b.resolved).length
  console.log(`\nPhase B done in ${phaseBElapsed}s: +${phaseBNew} resolved`)

  const results = phaseA.map((p) => {
    if (p.resolved) return p
    return phaseB.find((q) => q.row === p.row) ?? p
  })

  // Tally
  const tally = { resolved: 0, unresolved: 0, alreadyDirect: 0 }
  const bySource: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  for (const { resolved } of results) {
    if (!resolved) {
      tally.unresolved++
      continue
    }
    tally.resolved++
    if (resolved.source === "already_direct") tally.alreadyDirect++
    bySource[resolved.source] = (bySource[resolved.source] ?? 0) + 1
    byProvider[resolved.provider] = (byProvider[resolved.provider] ?? 0) + 1
  }

  // Write output CSV
  const outLines = [
    `"name","input_url","ats_type","resolved_provider","direct_url","identifier","source"`,
  ]
  for (const { row, resolved } of results) {
    outLines.push(
      [
        csvField(row.name),
        csvField(row.careers_url),
        csvField(row.ats_type),
        csvField(resolved?.provider ?? ""),
        csvField(resolved?.directUrl ?? ""),
        csvField(resolved?.identifier ?? ""),
        csvField(resolved?.source ?? "unresolved"),
      ].join(",")
    )
  }
  const outPath = resolve("scripts/output/ats-url-resolution.csv")
  writeFileSync(outPath, outLines.join("\n"))

  console.log(`\nResolved:    ${tally.resolved} / ${candidates.length}`)
  console.log(`  already direct: ${tally.alreadyDirect}`)
  console.log(`  by source: ${JSON.stringify(bySource)}`)
  console.log(`  by provider: ${JSON.stringify(byProvider)}`)
  console.log(`Unresolved:  ${tally.unresolved}`)
  console.log(`\nWrote: ${outPath}`)
  process.exit(0)
}

main()
