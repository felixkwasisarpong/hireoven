/**
 * Scrape builtin.com/companies via Playwright and extract company entries.
 *
 * Two phases, each written incrementally to disk so the script is resumable:
 *
 *   Phase 1 (list pages): For each /companies?page=N from --from to --to,
 *   pull every (name, builtin_profile_path, brief) tuple. Output:
 *   data/builtin-list.jsonl.
 *
 *   Phase 2 (profile pages): For each unique entry from phase 1, visit the
 *   profile page and extract the real company website URL plus the
 *   "Open Jobs" / careers link if visible. Output:
 *   data/builtin-enriched.jsonl.
 *
 * Phase 3 (DB insert) lives in seed-builtin-companies.ts, which reads the
 * enriched JSONL and runs the existing discovery + insert pipeline.
 *
 * Usage:
 *   npx tsx scripts/scrape-builtin-companies.ts --phase=list --from=1 --to=3
 *   npx tsx scripts/scrape-builtin-companies.ts --phase=enrich --concurrency=4 --limit=200
 *   npx tsx scripts/scrape-builtin-companies.ts --phase=list --from=1 --to=500    # full sweep
 *
 * Both phases skip entries already present in the output file (resume-safe).
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { chromium, type Browser, type BrowserContext } from "playwright"

const args = process.argv.slice(2)
const phase = (args.find((a) => a.startsWith("--phase="))?.split("=")[1] ?? "list") as "list" | "enrich"
const fromPage = Number(args.find((a) => a.startsWith("--from="))?.split("=")[1]) || 1
const toPage = Number(args.find((a) => a.startsWith("--to="))?.split("=")[1]) || 3
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 1)
const headed = args.includes("--headed")
const timeoutMs = Number(args.find((a) => a.startsWith("--timeout="))?.split("=")[1]) || 30_000

const DATA_DIR = path.join(process.cwd(), "data")
const LIST_PATH = path.join(DATA_DIR, "builtin-list.jsonl")
const ENRICH_PATH = path.join(DATA_DIR, "builtin-enriched.jsonl")
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

type ListEntry = {
  name: string
  profile_path: string // e.g. "/company/stripe"
  brief: string | null
  scraped_at: string
}

type EnrichedEntry = ListEntry & {
  website: string | null
  domain: string | null
  external_careers_url: string | null
  industry_tags: string[]
  location: string | null
  enriched_at: string
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function appendJsonl<T>(filePath: string, items: T[]) {
  if (items.length === 0) return
  const text = items.map((item) => JSON.stringify(item)).join("\n") + "\n"
  fs.appendFileSync(filePath, text)
}

async function launchBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  })
  // Block heavy assets to save bandwidth
  await context.route("**/*", (route) => {
    const type = route.request().resourceType()
    if (type === "image" || type === "media" || type === "font") return route.abort()
    return route.continue()
  })
  return { browser, context }
}

async function scrapeListPages() {
  ensureDataDir()
  const existing = readJsonl<ListEntry>(LIST_PATH)
  const seen = new Set(existing.map((e) => e.profile_path))
  console.log(`Phase: list. Pages ${fromPage}-${toPage}. Existing entries: ${existing.length}`)

  const { browser, context } = await launchBrowser()
  try {
    for (let pageNum = fromPage; pageNum <= toPage; pageNum++) {
      const url = `https://builtin.com/companies?page=${pageNum}`
      const page = await context.newPage()
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        // Wait for at least one company card to render (selector resilient
        // to class-name churn: any anchor whose href starts with /company/).
        await page.waitForSelector('a[href^="/company/"]', { timeout: timeoutMs }).catch(() => null)
        const entries = await page.evaluate(() => {
          const out: { name: string; profile_path: string; brief: string | null }[] = []
          const seenLocal = new Set<string>()
          for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/company/"]'))) {
            const href = anchor.getAttribute("href")?.split("?")[0]?.split("#")[0]
            if (!href || !/^\/company\/[a-z0-9-]+\/?$/i.test(href)) continue
            if (seenLocal.has(href)) continue
            // Find the closest card container, then prefer h2/h3 text as name.
            const card = anchor.closest('[class*="card"], [class*="Card"], li, article') ?? anchor
            const heading = card.querySelector("h2,h3")
            const name = (heading?.textContent ?? anchor.textContent ?? "").trim().replace(/\s+/g, " ")
            if (!name || name.length > 120) continue
            const briefEl = card.querySelector('[class*="description"], p')
            const brief = briefEl?.textContent?.trim().slice(0, 400) ?? null
            seenLocal.add(href)
            out.push({ name, profile_path: href, brief })
          }
          return out
        })

        const fresh = entries
          .filter((e) => !seen.has(e.profile_path))
          .map((e) => ({ ...e, scraped_at: new Date().toISOString() }))

        if (fresh.length) {
          appendJsonl(LIST_PATH, fresh)
          for (const e of fresh) seen.add(e.profile_path)
        }
        console.log(`  page ${pageNum}: ${entries.length} cards, ${fresh.length} new (running total: ${seen.size})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  page ${pageNum}: error — ${msg}`)
      } finally {
        await page.close().catch(() => null)
      }
      // Be polite between pages
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400))
    }
  } finally {
    await context.close().catch(() => null)
    await browser.close().catch(() => null)
  }
  const final = readJsonl<ListEntry>(LIST_PATH)
  console.log(`Done. Total entries in ${LIST_PATH}: ${final.length}`)
}

async function enrichProfiles() {
  ensureDataDir()
  const list = readJsonl<ListEntry>(LIST_PATH)
  if (list.length === 0) {
    console.error(`No list entries at ${LIST_PATH}. Run --phase=list first.`)
    process.exit(1)
  }
  const enriched = readJsonl<EnrichedEntry>(ENRICH_PATH)
  const enrichedSet = new Set(enriched.map((e) => e.profile_path))
  const todo = list.filter((e) => !enrichedSet.has(e.profile_path)).slice(0, limit)
  console.log(`Phase: enrich. List size: ${list.length}, already enriched: ${enriched.length}, to do: ${todo.length}`)

  const { browser, context } = await launchBrowser()
  const queue = [...todo]
  let done = 0

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) break
      const url = `https://builtin.com${next.profile_path}`
      const page = await context.newPage()
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        const extracted = await page.evaluate(() => {
          // Inline helpers — keep this block free of named arrow funcs so the
          // tsx transpiler doesn't inject __name into the browser sandbox.
          const SUB_PREFIXES_RE = /^(?:www|jobs?|careers?|apply|hire|apps?|portal|recruit|join|talent)\./i
          const SOCIAL_HOSTS_RE = /(?:linkedin|twitter|x\.com|facebook|instagram|youtube|github|crunchbase|glassdoor|angellist|builtin)\.com$/i

          let website: string | null = null
          let external_careers_url: string | null = null
          const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          const externals: URL[] = []
          for (const a of anchors) {
            const href = a.getAttribute("href") ?? ""
            if (!/^https?:\/\//i.test(href)) continue
            let h: URL
            try { h = new URL(href) } catch { continue }
            if (h.hostname.includes("builtin.com")) continue
            if (SOCIAL_HOSTS_RE.test(h.hostname)) continue
            externals.push(h)
            const label = (a.textContent ?? "").trim().toLowerCase()
            if (!website && (label === "website" || label.startsWith("visit") || label === "view website")) {
              website = "https://" + h.hostname.toLowerCase().replace(SUB_PREFIXES_RE, "")
            }
            if (
              !external_careers_url &&
              /careers?|jobs?|join|opportunit/i.test(h.pathname + " " + label)
            ) {
              external_careers_url = h.toString()
            }
          }
          // Fallback: pick the most-referenced external apex (excludes socials).
          if (!website && externals.length) {
            const counts: Record<string, number> = {}
            for (const u of externals) {
              const host = u.hostname.toLowerCase().replace(SUB_PREFIXES_RE, "")
              counts[host] = (counts[host] ?? 0) + 1
            }
            let topHost: string | null = null
            let topCount = 0
            for (const k of Object.keys(counts)) {
              if (counts[k] > topCount) { topCount = counts[k]; topHost = k }
            }
            if (topHost) website = "https://" + topHost
          }

          const industry_tags: string[] = []
          for (const el of document.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="industry"], [class*="Industry"]')) {
            const t = (el.textContent ?? "").trim()
            if (t && t.length <= 40 && industry_tags.indexOf(t) === -1) industry_tags.push(t)
            if (industry_tags.length >= 6) break
          }
          // Location: look for an element with text like "City, State" near the heading.
          let location: string | null = null
          const locEl = document.querySelector('[class*="location"], [class*="Location"]')
          if (locEl) location = (locEl.textContent ?? "").trim().slice(0, 80) || null

          return { website, external_careers_url, industry_tags, location }
        })
        const domain = (() => {
          if (!extracted.website) return null
          try {
            return new URL(extracted.website).hostname.replace(/^www\./, "")
          } catch { return null }
        })()
        const row: EnrichedEntry = {
          ...next,
          website: extracted.website,
          domain,
          external_careers_url: extracted.external_careers_url,
          industry_tags: extracted.industry_tags,
          location: extracted.location,
          enriched_at: new Date().toISOString(),
        }
        appendJsonl(ENRICH_PATH, [row])
        done++
        if (done % 10 === 0) console.log(`  enriched ${done}/${todo.length} (last: ${next.name} → ${domain ?? "(no domain)"})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  ${next.name}: ${msg}`)
      } finally {
        await page.close().catch(() => null)
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  await context.close().catch(() => null)
  await browser.close().catch(() => null)
  const final = readJsonl<EnrichedEntry>(ENRICH_PATH)
  const withDomain = final.filter((e) => e.domain).length
  console.log(`Done. Enriched ${final.length} entries; ${withDomain} have a domain.`)
}

async function main() {
  if (phase === "list") return scrapeListPages()
  if (phase === "enrich") return enrichProfiles()
  console.error(`Unknown phase: ${phase}. Use --phase=list or --phase=enrich.`)
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
