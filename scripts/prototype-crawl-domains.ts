/**
 * PROTOTYPE (read-only): measure how well a render-crawl of an ATS careers page
 * recovers a company's true website domain for blank ATS-tenant companies.
 *
 * Extraction, best signal first:
 *   1. schema.org JobPosting/Organization JSON-LD -> hiringOrganization.url / sameAs
 *      (on job-DETAIL pages; if the careers_url is a board, we open the first job).
 *   2. og:url / canonical / og:image host.
 *   3. Outbound links whose registrable slug matches a company-name token, else a
 *      single lone non-ATS/non-CDN outbound link.
 * All candidates are filtered against ATS / social / CDN hosts.
 *
 *   npx tsx scripts/prototype-crawl-domains.ts [--limit=150]
 */
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import type { Browser } from "playwright"

loadEnvConfig(process.cwd())
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "150")

const BAD_HOST_RE =
  /(greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|myworkdayjobs|workday|icims|jobvite|bamboohr|recruitee|teamtailor|personio|breezy|jazzhr|jazz\.co|rippling|paylocity|ukg|\.adp\.|successfactors|taleo|dayforce|paycom|eightfold|phenom|jobvite|linkedin|licdn|facebook|fb\.com|twitter|x\.com|instagram|youtube|tiktok|glassdoor|indeed|ziprecruiter|builtin|\.google\.|gstatic|googleapis|googletagmanager|schema\.org|w3\.org|cloudfront|amazonaws|azureedge|cloudflare|akamai|imgix|ctfassets|contentful|hotjar|segment|cookiebot|gravatar|githubusercontent|vimeo|calendly|typeform|bit\.ly|goo\.gl|adzuna|dice\.com|wistia|intercom|sentry|datadog|greenhouse-mail)/i

const GENERIC = new Set(["the","and","of","for","inc","llc","ltd","corp","co","company","group","holdings","technologies","technology","solutions","services","systems","global","international","careers","jobs","team","hiring","talent","group","the"])
function nameTokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !GENERIC.has(t))
}
function regHost(u: string): string | null { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return null } }
function hostSlug(h: string): string { const l = h.split("."); return (l.length > 1 ? l.slice(0, -1) : l).join("") }
const ok = (h: string | null, careersHost: string): h is string =>
  !!h && h !== careersHost && !BAD_HOST_RE.test(h) && /\.[a-z]{2,}$/.test(h) && h.length <= 45

function fromJsonLd(html: string): { urls: string[] } {
  const urls: string[] = []
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    const nodes: any[] = []
    const push = (x: any) => { if (x && typeof x === "object") nodes.push(x) }
    if (Array.isArray(data)) data.forEach(push)
    else { push(data); if (Array.isArray(data["@graph"])) data["@graph"].forEach(push) }
    for (const n of nodes) {
      const org = n.hiringOrganization || (String(n["@type"] || "").includes("Organization") ? n : null)
      if (!org) continue
      if (typeof org.url === "string") urls.push(org.url)
      const sa = org.sameAs
      if (Array.isArray(sa)) urls.push(...sa.filter((s: any) => typeof s === "string"))
      else if (typeof sa === "string") urls.push(sa)
    }
  }
  return { urls }
}

function extractDomain(html: string, careersHost: string, name: string): string | null {
  const tokens = nameTokens(name)
  // 1. JSON-LD hiringOrganization (highest precision)
  for (const u of fromJsonLd(html).urls) { const h = regHost(u); if (ok(h, careersHost)) return h }
  // 2. og:url / canonical / og:image
  const metaHosts: string[] = []
  for (const m of html.matchAll(/(?:property|rel|name)=["'](?:og:url|canonical|og:image|twitter:image)["'][^>]*?(?:content|href)=["'](https?:\/\/[^"']+)/gi)) {
    const h = regHost(m[1]); if (ok(h, careersHost)) metaHosts.push(h)
  }
  // 3. outbound links
  const linkHosts = new Set<string>()
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) { const h = regHost(m[0]); if (ok(h, careersHost)) linkHosts.add(h) }
  const all = [...new Set([...metaHosts, ...linkHosts])]
  const named = all.filter((h) => tokens.some((t) => hostSlug(h).includes(t) || (hostSlug(h).length >= 4 && t.includes(hostSlug(h)))))
  if (named.length) return named.sort((a, b) => a.length - b.length)[0]!
  if (metaHosts.length) return metaHosts.sort((a, b) => a.length - b.length)[0]!
  if (all.length === 1) return all[0]!               // a single lone outbound company link
  return null
}

/** First job-detail URL on the board (same ATS host, deeper path) to get JSON-LD. */
function firstJobUrl(html: string, careersHost: string): string | null {
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const u = m[0]; const h = regHost(u)
    if (h === careersHost && /\/(jobs?|j|postings?|opportunit|position)\/[^/]+|\/[0-9a-f]{6,}/i.test(new URL(u).pathname)) return u
  }
  return null
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query<{ name: string; careers_url: string }>(
    `SELECT name, careers_url FROM companies
     WHERE is_active AND careers_url ~ '^https?://'
       AND domain ~ '(greenhouse|lever\\.co|ashbyhq|smartrecruiters|workable|-tenant)'
       AND careers_url !~ '(adzuna|linkedin|indeed)'
     ORDER BY random() LIMIT $1`, [LIMIT]
  )
  console.log(`sample: ${rows.length} blank ATS-tenant companies\n`)

  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({ headless: true })
  const render = async (url: string): Promise<string | null> => {
    let ctx, page
    try {
      ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36" })
      page = await ctx.newPage()
      await page.route("**/*", (r) => (["image", "media", "font"].includes(r.request().resourceType()) ? r.abort() : r.continue()))
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
      try { await page.waitForLoadState("networkidle", { timeout: 6000 }) } catch {}
      return await page.content()
    } catch { return null } finally { try { await page?.close() } catch {}; try { await ctx?.close() } catch {} }
  }

  let hit = 0, miss = 0, err = 0
  const conc = 4
  let i = 0
  async function worker() {
    while (i < rows.length) {
      const c = rows[i++]!
      const careersHost = regHost(c.careers_url) ?? ""
      const html = await render(c.careers_url)
      if (!html) { err++; console.log(`  ⚠︎ ${c.name} — render failed`); continue }
      let d = extractDomain(html, careersHost, c.name)
      if (!d) { const ju = firstJobUrl(html, careersHost); if (ju) { const jh = await render(ju); if (jh) d = extractDomain(jh, careersHost, c.name) } }
      if (d) { hit++; console.log(`  ✓ ${c.name.slice(0, 28).padEnd(28)} -> ${d}`) }
      else { miss++; console.log(`  ✗ ${c.name.slice(0, 28).padEnd(28)}`) }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  await browser.close()
  console.log(`\n── hit ${hit} | miss ${miss} | render-err ${err} | rate ${((hit / rows.length) * 100).toFixed(0)}%`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
