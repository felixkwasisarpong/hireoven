/**
 * Salvage path for the BuiltIn scrape: for each name without a domain from
 * the enrich phase, generate slug+TLD candidates and probe them with plain
 * HTTPS (no Playwright, no BuiltIn — so no Cloudflare WAF block). Accept the
 * first candidate that returns a 200 AND verifies as the right company by
 * containing a name-token in its <title> or first ~16 KB of HTML.
 *
 * Output (resumable): data/builtin-probed.jsonl with the same shape as the
 * enriched file. seed-builtin-companies.ts already reads this file via the
 * default path, so no changes needed there if we --input it correctly; we
 * write to its own file so the two stay separate for audit.
 *
 * Usage:
 *   npx tsx scripts/probe-builtin-slugs.ts --concurrency=30
 *   npx tsx scripts/probe-builtin-slugs.ts --limit=200            # smoke test
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 24)
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const timeoutMs = Number(args.find((a) => a.startsWith("--timeout="))?.split("=")[1]) || 8000

const DATA_DIR = path.join(process.cwd(), "data")
const LIST_PATH = path.join(DATA_DIR, "builtin-list.jsonl")
const ENRICH_PATH = path.join(DATA_DIR, "builtin-enriched.jsonl")
const PROBED_PATH = path.join(DATA_DIR, "builtin-probed.jsonl")
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

const TLDS = ["com", "io", "co", "ai", "xyz", "net", "app"] as const

const STOPWORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "llc", "lp", "llp", "limited", "plc", "the", "and", "of", "for",
  "group", "holdings", "holding", "international", "global", "us", "usa",
  "america", "north", "solutions", "technologies", "technology", "systems",
  "labs", "studio", "studios", "media", "ventures", "partners", "capital",
  "agency",
])

const PARKED_SIGNALS = [
  "buy this domain",
  "this domain is for sale",
  "domain is for sale",
  "parked free",
  "godaddy",
  "hugedomains",
  "domainmarket",
  "domain parking",
  "namecheap",
  "register.com",
  "dynadot",
  "afternic",
  "sedo.com",
]

type ListEntry = {
  name: string
  profile_path: string
  brief: string | null
  scraped_at: string
}

type EnrichedEntry = {
  name: string
  profile_path: string
  domain: string | null
  industry_tags: string[]
  location: string | null
  enriched_at: string
}

type ProbedEntry = {
  name: string
  profile_path: string
  brief: string | null
  domain: string | null
  matched_url: string | null
  matched_via: "exact_slug" | "first_word" | "hyphenated" | "name_no_space" | null
  industry_tags: string[]
  location: string | null
  candidates_tried: number
  probed_at: string
}

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T)
}

function appendJsonl<T>(p: string, items: T[]) {
  if (items.length === 0) return
  const text = items.map((i) => JSON.stringify(i)).join("\n") + "\n"
  fs.appendFileSync(p, text)
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && w.length >= 2)
}

function buildCandidates(name: string): Array<{ host: string; via: ProbedEntry["matched_via"] }> {
  const tokens = nameTokens(name)
  if (tokens.length === 0) return []
  const seen = new Set<string>()
  const out: Array<{ host: string; via: ProbedEntry["matched_via"] }> = []
  const push = (host: string, via: ProbedEntry["matched_via"]) => {
    const h = host.toLowerCase().replace(/[^a-z0-9.-]/g, "")
    if (!h || h.length < 4 || h.length > 60) return
    if (seen.has(h)) return
    seen.add(h)
    out.push({ host: h, via })
  }

  const concatenated = tokens.join("")
  const hyphenated = tokens.join("-")
  const firstWord = tokens[0]

  // Priority order: concatenated → first word → hyphenated, across TLDs.
  for (const tld of TLDS) {
    push(`${concatenated}.${tld}`, "name_no_space")
  }
  if (firstWord && firstWord !== concatenated) {
    for (const tld of TLDS) {
      push(`${firstWord}.${tld}`, "first_word")
    }
  }
  if (tokens.length > 1 && hyphenated !== concatenated) {
    for (const tld of TLDS) {
      push(`${hyphenated}.${tld}`, "hyphenated")
    }
  }
  return out
}

async function fetchSnippet(url: string): Promise<{ ok: boolean; status: number | null; finalUrl: string | null; bodyHead: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    if (!res.body) return { ok: res.ok, status: res.status, finalUrl: res.url, bodyHead: "" }
    const reader = res.body.getReader()
    let received = 0
    const chunks: Uint8Array[] = []
    while (received < 16 * 1024) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
    try { await reader.cancel() } catch {}
    const buf = new Uint8Array(received)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
    const bodyHead = new TextDecoder("utf-8", { fatal: false }).decode(buf)
    return { ok: res.ok, status: res.status, finalUrl: res.url, bodyHead }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function pageLooksParked(snippet: string): boolean {
  const lower = snippet.toLowerCase()
  return PARKED_SIGNALS.some((sig) => lower.includes(sig))
}

function pageMatchesName(snippet: string, nameTokensLower: string[]): boolean {
  // Pull the <title> and first <h1>, lowercase, check for any name token >= 4 chars.
  const lower = snippet.toLowerCase()
  const titleMatch = lower.match(/<title[^>]*>([^<]{0,200})<\/title>/i)
  const h1Match = lower.match(/<h1[^>]*>([^<]{0,200})<\/h1>/i)
  const ogMatch = lower.match(/<meta\b[^>]*property=["']og:site_name["'][^>]*content=["']([^"']{0,100})["']/i)
  const fragments = [titleMatch?.[1] ?? "", h1Match?.[1] ?? "", ogMatch?.[1] ?? ""]
  const blob = fragments.join(" ")
  if (!blob.trim()) {
    // Fallback to whole snippet — heavier but covers SPA shells with bare titles.
    return nameTokensLower.some((t) => t.length >= 5 && lower.includes(t))
  }
  return nameTokensLower.some((t) => t.length >= 4 && blob.includes(t))
}

async function probeOne(entry: ListEntry): Promise<ProbedEntry> {
  const tokensLower = nameTokens(entry.name)
  const candidates = buildCandidates(entry.name)
  let tried = 0
  for (const { host, via } of candidates) {
    tried += 1
    const url = `https://${host}`
    const snap = await fetchSnippet(url)
    if (!snap || !snap.ok) continue
    if (pageLooksParked(snap.bodyHead)) continue
    if (!pageMatchesName(snap.bodyHead, tokensLower)) continue
    // Pick the apex from the final URL (after redirects).
    let domain = host
    try {
      const u = new URL(snap.finalUrl ?? url)
      domain = u.hostname.replace(/^www\./, "")
    } catch {}
    return {
      name: entry.name,
      profile_path: entry.profile_path,
      brief: entry.brief,
      domain,
      matched_url: snap.finalUrl ?? url,
      matched_via: via,
      industry_tags: [],
      location: null,
      candidates_tried: tried,
      probed_at: new Date().toISOString(),
    }
  }
  return {
    name: entry.name,
    profile_path: entry.profile_path,
    brief: entry.brief,
    domain: null,
    matched_url: null,
    matched_via: null,
    industry_tags: [],
    location: null,
    candidates_tried: tried,
    probed_at: new Date().toISOString(),
  }
}

async function runPool<T, R>(items: T[], n: number, worker: (item: T) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const queue = [...items]
  const out: R[] = []
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) break
        const r = await worker(next)
        out.push(r)
        done++
        if (onProgress) onProgress(done, items.length)
      }
    })
  )
  return out
}

async function main() {
  const list = readJsonl<ListEntry>(LIST_PATH)
  if (list.length === 0) {
    console.error(`Missing ${LIST_PATH}. Run --phase=list first.`)
    process.exit(1)
  }
  const enriched = readJsonl<EnrichedEntry>(ENRICH_PATH)
  const enrichedByPath = new Map(enriched.map((e) => [e.profile_path, e]))
  const probed = readJsonl<ProbedEntry>(PROBED_PATH)
  const probedSet = new Set(probed.map((e) => e.profile_path))

  // Targets: list entries that DON'T already have a confirmed domain from
  // either the enrich phase or a previous probe run.
  const todo = list.filter((entry) => {
    const en = enrichedByPath.get(entry.profile_path)
    if (en?.domain) return false
    if (probedSet.has(entry.profile_path)) return false
    return true
  })
  const capped = todo.slice(0, Number.isFinite(limit) ? limit : todo.length)
  console.log(`Probe targets: ${capped.length} (skipping ${list.length - capped.length - probed.length} already-done; ${probed.length} previously probed)`)

  let lastLogged = 0
  let runningHits = 0
  const probeOneTrack = async (entry: ListEntry) => {
    const r = await probeOne(entry)
    if (r.domain) runningHits += 1
    return r
  }
  const results = await runPool(capped, concurrency, probeOneTrack, (done) => {
    if (done - lastLogged >= 200 || done === capped.length) {
      lastLogged = done
      console.log(`  probed ${done}/${capped.length}  hits-so-far=${runningHits}`)
    }
  })

  appendJsonl(PROBED_PATH, results)
  const hits = results.filter((r) => r.domain).length
  console.log(`\nDone. Wrote ${results.length} probe records.`)
  console.log(`  hits (apex domain confirmed): ${hits}`)
  console.log(`  no match (no candidate passed verification): ${results.length - hits}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
