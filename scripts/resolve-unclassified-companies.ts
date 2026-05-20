/**
 * One-shot: re-classify active companies whose ats_type is NULL by
 * running the existing resolveDirectAtsUrl against their careers_url.
 * Read-only by default; --apply writes ats_type / ats_identifier /
 * direct_ats_url and clears next_harvest_at so the worker picks them up.
 *
 *   npx tsx scripts/resolve-unclassified-companies.ts                # dry run
 *   npx tsx scripts/resolve-unclassified-companies.ts --concurrency=4
 *   npx tsx scripts/resolve-unclassified-companies.ts --apply
 *   npx tsx scripts/resolve-unclassified-companies.ts --limit=20     # try a sample first
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveDirectAtsUrl, type ResolvedAtsUrl } from "@/lib/companies/ats-url-resolver"

const RESOLVE_CACHE = path.join(process.cwd(), ".cache", "resolve-unclassified.json")

// undici's fetch occasionally throws `ERR_INVALID_STATE: Controller is
// already closed` after a fetch was aborted on timeout — the error
// surfaces in a microtask outside our try/catch and kills the process.
// Log and swallow so the batch keeps running.
process.on("uncaughtException", (err) => {
  if ((err as NodeJS.ErrnoException).code === "ERR_INVALID_STATE") return
  console.error("[uncaughtException]", err)
})
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.message : reason)
})

type Row = {
  id: string
  name: string
  careers_url: string
  domain: string | null
}

function flagInt(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const a = process.argv.find((x) => x.startsWith(prefix))
  if (!a) return fallback
  const n = Number.parseInt(a.slice(prefix.length), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

type Outcome = {
  row: Row
  result: ResolvedAtsUrl | null
  verified?: boolean
  verifyDetail?: string
  errorMessage?: string
  elapsedMs: number
}

// Words we strip from company names before comparing against ATS board
// titles. Mostly suffixes ("inc", "llc"), generic descriptors ("public",
// "services"), and high-frequency stop words.
const COMPANY_STOPWORDS = new Set([
  "inc","llc","corp","corporation","ltd","limited","co","company","holdings",
  "the","of","and","group","international","intl","usa","us","america",
  "american","global","public","services","systems","technologies","solutions",
  "industries","enterprises","partners","operations","worldwide","incorporated",
  "labs","ai","io","app","tech","studio","studios","brands","plc","sa","gmbh",
])

function distinctiveTokens(name: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (COMPANY_STOPWORDS.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out
}

// Verify a slug_probe hit by fetching the candidate board and looking for
// the company name. The probe heuristic guesses slugs from the first word
// of the company name, which collides constantly with unrelated boards
// (e.g. "ohio" matching The Ohio State University to some other "ohio").
function distinctiveTokenSet(s: string): Set<string> {
  // Strip HTML entities before tokenizing so &amp; doesn't add a
  // spurious "amp" token to a board name like "Turner &amp; Townsend".
  const decoded = s.toLowerCase().replace(/&(amp|lt|gt|quot|nbsp|#\d+);/g, " ")
  const out = new Set<string>()
  for (const raw of decoded.split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (COMPANY_STOPWORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

function smushName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// Single-token board slugs we never accept as a positive match, because
// they're generic enough that they belong to many unrelated boards. Add
// to this set whenever a new false positive of this shape surfaces.
const GENERIC_SINGLE_TOKENS = new Set([
  "super","harmony","global","united","next","first","top","best","new",
  "blue","green","gold","metro","pro","prime","apex","ace","local","central",
  "ai","io","app","tech","data","cloud","work","play","core","alpha","beta",
  "ohio","chicago","lincoln","texas","atlanta","york","boston","austin",
])

function namesMatch(boardName: string, companyName: string): { ok: boolean; reason: string } {
  const a = distinctiveTokenSet(boardName)
  const b = distinctiveTokenSet(companyName)

  // Token-based match. The core invariant: the BOARD'S distinctive
  // tokens must be a subset of the COMPANY'S distinctive tokens — i.e.,
  // the board can be a shorter form (Goodwin ⊂ Goodwin Procter LLP) but
  // not introduce its own identity (McAfee Heating & Air Conditioning ⊄
  // McAfee LLC). The b ⊆ a direction is intentionally disallowed because
  // that's the shape of "wrong company that happens to share a word".
  if (a.size > 0 && b.size > 0) {
    const aIsSubsetOfB = [...a].every((t) => b.has(t))
    if (aIsSubsetOfB) {
      const setsIdentical = a.size === b.size
      const onlyToken = a.size === 1 ? [...a][0] : null
      if (setsIdentical) {
        return { ok: true, reason: `tokens identical; ${[...a].join(",")}` }
      }
      if (onlyToken) {
        if (GENERIC_SINGLE_TOKENS.has(onlyToken)) {
          return { ok: false, reason: `single_generic_token=${onlyToken}` }
        }
        if (onlyToken.length >= 4) {
          return { ok: true, reason: `single_distinctive_token=${onlyToken} (len=${onlyToken.length})` }
        }
        return { ok: false, reason: `single_short_token=${onlyToken} (len=${onlyToken.length} < 4)` }
      }
      // Multi-token board, fully contained in larger company name. Strong.
      return { ok: true, reason: `multi-token subset; a=${a.size} ⊂ b=${b.size}` }
    }
  }

  // Smushed-name substring fallback for cases where the tokenizer
  // disagrees with the board (e.g., "I-Link Solutions" → ["i","link"]
  // vs board "ilink solutions" → ["ilink"]). Tighter threshold (≥ 6)
  // than before so generic short slugs don't sneak through here.
  const sa = smushName(boardName)
  const sb = smushName(companyName)
  if (sa.length >= 6 && sb.length >= 6) {
    const [shorter, longer] = sa.length <= sb.length ? [sa, sb] : [sb, sa]
    if (longer.includes(shorter)) {
      return { ok: true, reason: `smush_substring (${shorter} ⊂ ${longer})` }
    }
  }

  return { ok: false, reason: `no_match; tokens a=[${[...a].join(",")}] b=[${[...b].join(",")}]; smush ${sa}/${sb}` }
}

async function fetchBoardName(
  provider: string,
  slug: string
): Promise<{ name: string | null; exists: boolean; detail: string }> {
  const ac = new AbortController()
  const tm = setTimeout(() => ac.abort(), 8_000)
  const headers = { "user-agent": "Mozilla/5.0 (HireovenResolverVerify/1.0)" }
  try {
    switch (provider) {
      case "greenhouse": {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, { signal: ac.signal, headers })
        if (!res.ok) return { name: null, exists: false, detail: `gh_http_${res.status}` }
        const j = (await res.json()) as { name?: string }
        return { name: typeof j?.name === "string" ? j.name : null, exists: true, detail: "gh_ok" }
      }
      case "smartrecruiters": {
        const res = await fetch(`https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}`, { signal: ac.signal, headers, redirect: "follow" })
        if (!res.ok) return { name: null, exists: false, detail: `sr_http_${res.status}` }
        const html = (await res.text()).slice(0, 20_000)
        const m = html.match(/<title>([^<]+)<\/title>/i)
        if (!m) return { name: null, exists: true, detail: "sr_no_title" }
        const title = m[1].replace(/^\s*Careers at\s+/i, "").replace(/\s*\|.*$/, "").trim()
        return { name: title, exists: true, detail: "sr_title" }
      }
      case "lever": {
        const res = await fetch(`https://jobs.lever.co/${encodeURIComponent(slug)}`, { signal: ac.signal, headers, redirect: "follow" })
        if (!res.ok) return { name: null, exists: false, detail: `lever_http_${res.status}` }
        const html = (await res.text()).slice(0, 20_000)
        const m = html.match(/<title>([^<]+)<\/title>/i)
        if (!m) return { name: null, exists: true, detail: "lever_no_title" }
        const title = m[1].trim()
        if (/^Not found/i.test(title) || /404/.test(title)) return { name: null, exists: false, detail: "lever_404_title" }
        return { name: title, exists: true, detail: "lever_title" }
      }
      case "ashby": {
        // Ashby's posting API returns the literal string "Not Found" for
        // unknown slugs and a JSON `{jobs,apiVersion}` object otherwise.
        // No company-name field is exposed, so we treat existence as
        // necessary-but-not-sufficient and gate on a strong slug↔name
        // match in the caller.
        const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`, { signal: ac.signal, headers })
        if (!res.ok) return { name: null, exists: false, detail: `ashby_http_${res.status}` }
        const text = await res.text()
        if (text.startsWith("Not Found")) return { name: null, exists: false, detail: "ashby_not_found" }
        try {
          const j = JSON.parse(text)
          if (!j || !Array.isArray(j.jobs)) return { name: null, exists: false, detail: "ashby_unexpected_body" }
          return { name: null, exists: true, detail: "ashby_exists_no_name" }
        } catch {
          return { name: null, exists: false, detail: "ashby_invalid_json" }
        }
      }
      default:
        // successfactors / taleo / icims / workday — these mostly come
        // from non-probe sources (form_action / embedded_link / already_direct)
        // which we don't run through verifyHit at all. The few slug_probe
        // exceptions we just accept here.
        return { name: null, exists: true, detail: `${provider}_unverified` }
    }
  } catch (err) {
    return { name: null, exists: false, detail: `fetch_error: ${(err as Error).message.slice(0, 40)}` }
  } finally {
    clearTimeout(tm)
  }
}

async function verifyHit(provider: string, slug: string | null, companyName: string): Promise<{
  ok: boolean
  detail: string
}> {
  if (!slug) return { ok: false, detail: "no slug" }
  const board = await fetchBoardName(provider, slug)
  if (!board.exists) return { ok: false, detail: board.detail }

  if (board.name) {
    const nm = namesMatch(board.name, companyName)
    return {
      ok: nm.ok,
      detail: `${board.detail}; board="${board.name.slice(0, 40)}"; ${nm.reason}`,
    }
  }

  // No name from API (Ashby, or default fallback). Accept only if the
  // slug is a strong match against the company name — substring of the
  // normalized name and length ≥ 5.
  const normName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "")
  const normSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, "")
  const strongSlug = normSlug.length >= 5 && (normName.includes(normSlug) || normSlug.includes(normName))
  return {
    ok: strongSlug,
    detail: `${board.detail}; slug_strong_match=${strongSlug} (slug=${normSlug}, name=${normName})`,
  }
}

async function resolveOne(row: Row): Promise<Outcome> {
  const t0 = Date.now()
  try {
    const result = await resolveDirectAtsUrl(row.careers_url, {
      atsType: null,
      companyName: row.name,
      // Intentionally skip JS-render step: 1015 × 4s ≈ 67m on Playwright,
      // and the static + slug-probe path already covers the wide majority.
      renderHtml: null,
    })
    if (!result) return { row, result: null, elapsedMs: Date.now() - t0 }

    // Only slug_probe needs verification — the other sources (form_action,
    // embedded_link, already_direct, iframe_src, redirect) are real signals
    // from the company's own HTML and don't make up candidate slugs.
    if (result.source !== "slug_probe") {
      return { row, result, verified: true, verifyDetail: "skipped (non-probe source)", elapsedMs: Date.now() - t0 }
    }

    const v = await verifyHit(result.provider, result.identifier, row.name)
    return { row, result, verified: v.ok, verifyDetail: v.detail, elapsedMs: Date.now() - t0 }
  } catch (err) {
    return {
      row,
      result: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - t0,
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply")
  const reverify = process.argv.includes("--reverify") // skip resolve, re-run verify from cache
  const concurrency = flagInt("concurrency", 6)
  const limitN = flagInt("limit", 0)

  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<Row>(
      `SELECT id, name, careers_url, domain
       FROM companies
       WHERE status = 'active' AND is_active = true AND duplicate_of_company_id IS NULL
         AND ats_type IS NULL
         AND careers_url IS NOT NULL
       ORDER BY (SELECT count(*) FROM jobs j WHERE j.company_id = companies.id AND j.is_active = true) DESC,
                name ASC
       ${limitN > 0 ? `LIMIT ${limitN}` : ""}`
    )
    console.log(`Unclassified companies to resolve: ${rows.length}`)
    console.log(`Concurrency: ${concurrency}; mode: ${apply ? "APPLY" : "dry-run"}${reverify ? " (reverify from cache)" : ""}\n`)

    let outcomes: Outcome[]
    const startedAt = Date.now()

    if (reverify && fs.existsSync(RESOLVE_CACHE)) {
      // Replay the resolve results from cache, but re-run verification with
      // the current verifyHit implementation. Keeps iteration on verifier
      // logic fast — verification is ~30s vs. ~15min for full resolve.
      const cached: Outcome[] = JSON.parse(fs.readFileSync(RESOLVE_CACHE, "utf8"))
      console.log(`Loaded ${cached.length} cached resolves; re-verifying slug_probe hits...`)
      const limit = pLimit(concurrency)
      let done = 0
      outcomes = await Promise.all(
        cached.map((c) =>
          limit(async () => {
            if (!c.result || c.result.source !== "slug_probe") {
              done += 1
              return c
            }
            const v = await verifyHit(c.result.provider, c.result.identifier, c.row.name)
            done += 1
            if (done % 25 === 0 || done === cached.length) {
              console.log(`  reverify progress ${done}/${cached.length}`)
            }
            return { ...c, verified: v.ok, verifyDetail: v.detail }
          })
        )
      )
    } else {
      const limit = pLimit(concurrency)
      let done = 0
      outcomes = await Promise.all(
        rows.map((row) =>
          limit(async () => {
            const o = await resolveOne(row)
            done += 1
            if (done % 25 === 0 || done === rows.length) {
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
              console.log(`  progress ${done}/${rows.length} (${elapsed}s)`)
            }
            return o
          })
        )
      )
      // Persist for fast re-verification iterations.
      try {
        fs.mkdirSync(path.dirname(RESOLVE_CACHE), { recursive: true })
        fs.writeFileSync(RESOLVE_CACHE, JSON.stringify(outcomes, null, 2))
        console.log(`\nResults cached at ${RESOLVE_CACHE}`)
      } catch (err) {
        console.warn(`Could not write cache: ${(err as Error).message}`)
      }
    }

    const resolvedRaw = outcomes.filter((o) => o.result)
    const resolved = resolvedRaw.filter((o) => o.verified)
    const rejected = resolvedRaw.filter((o) => !o.verified)
    const unresolved = outcomes.filter((o) => !o.result)

    console.log(`\n=== Resolution summary (${rows.length} rows in ${((Date.now() - startedAt) / 1000).toFixed(0)}s) ===`)
    console.log(`  resolved+verified: ${resolved.length}`)
    console.log(`  resolved-but-rejected (slug_probe failed verify): ${rejected.length}`)
    console.log(`  unresolved: ${unresolved.length}`)

    if (rejected.length > 0) {
      console.log(`\nSample rejected (first 15):`)
      for (const o of rejected.slice(0, 15)) {
        console.log(`  - ${o.row.name} → ${o.result!.provider} ${o.result!.directUrl} | ${o.verifyDetail ?? ""}`)
      }
    }

    const byProvider = new Map<string, number>()
    for (const o of resolved) {
      const key = o.result!.provider
      byProvider.set(key, (byProvider.get(key) ?? 0) + 1)
    }
    console.log(`\nResolved by provider:`)
    for (const [k, v] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(20)} ${v}`)
    }

    const bySource = new Map<string, number>()
    for (const o of resolved) {
      const key = o.result!.source
      bySource.set(key, (bySource.get(key) ?? 0) + 1)
    }
    console.log(`\nResolved by source step:`)
    for (const [k, v] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(20)} ${v}`)
    }

    const errorRows = outcomes.filter((o) => o.errorMessage)
    if (errorRows.length > 0) {
      console.log(`\nErrors during resolution: ${errorRows.length}`)
      const reasons = new Map<string, number>()
      for (const o of errorRows) {
        const k = (o.errorMessage ?? "unknown").slice(0, 80)
        reasons.set(k, (reasons.get(k) ?? 0) + 1)
      }
      for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`  ${String(v).padStart(4)} ${k}`)
      }
    }

    console.log(`\n=== Sample resolved (first 15) ===`)
    for (const o of resolved.slice(0, 15)) {
      console.log(
        `- ${o.row.name} → ${o.result!.provider} (${o.result!.source}) | ${o.result!.directUrl} | id=${o.result!.identifier ?? "∅"}`
      )
    }

    if (!apply) {
      console.log(`\n[dry-run] Would update ${resolved.length} companies (ats_type/identifier/direct_ats_url).`)
      console.log(`Re-run with --apply to commit.`)
      return
    }

    // Persist resolved rows. ats_type accepts whatever the resolver returns;
    // canonicalCareersUrl + worker filter handle the rest.
    let updated = 0
    for (const o of resolved) {
      const r = o.result!
      try {
        await pool.query(
          `UPDATE companies
           SET ats_type = $2,
               ats_identifier = COALESCE($3, ats_identifier),
               direct_ats_url = COALESCE($4, direct_ats_url),
               next_harvest_at = now()
           WHERE id = $1`,
          [o.row.id, r.provider, r.identifier, r.directUrl]
        )
        updated += 1
      } catch (err) {
        console.error(`  update failed for ${o.row.name}: ${(err as Error).message}`)
      }
    }
    console.log(`\nUpdated ${updated} companies.`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
