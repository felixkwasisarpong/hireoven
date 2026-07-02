/**
 * Recover real company domains for blank ATS-tenant companies by render-crawling
 * their careers page, then VERIFY before writing:
 *   extract (JSON-LD hiringOrganization -> og/canonical -> name-matched outbound)
 *   -> homepageOwns (domain's homepage mentions the company)  [kills CDN/wrong]
 *   -> hasLogoMark (logo.dev renders a real mark)              [keeps it useful]
 *   -> if the verified domain already belongs to a canonical row: MERGE into it
 *      (safe delete-free pattern); else SET domain + logo_url on the blank row.
 *
 *   npx tsx scripts/crawl-company-domains.ts --dry-run --limit=150
 *   npx tsx scripts/crawl-company-domains.ts --apply --limit=2000 --concurrency=6
 */
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import type { Browser } from "playwright"

loadEnvConfig(process.cwd())
const argv = process.argv.slice(2)
const APPLY = argv.includes("--apply")
const DRY_RUN = !APPLY
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "150")
const CONC = Number(argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "5")
const LOGO_TOKEN = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""

const BAD_HOST_RE =
  /(greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|myworkdayjobs|workday|icims|jobvite|bamboohr|recruitee|teamtailor|personio|breezy|jazzhr|jazz\.co|rippling|paylocity|ukg|\.adp\.|successfactors|taleo|dayforce|paycom|eightfold|phenom|linkedin|licdn|facebook|fb\.com|twitter|x\.com|instagram|youtube|tiktok|glassdoor|indeed|ziprecruiter|builtin|\.google\.|gstatic|googleapis|googletagmanager|schema\.org|w3\.org|cloudfront|amazonaws|azureedge|cloudflare|akamai|imgix|ctfassets|contentful|hotjar|segment|cookiebot|gravatar|githubusercontent|vimeo|calendly|typeform|bit\.ly|goo\.gl|adzuna|dice\.com|wistia|intercom|sentry|datadog|zscdn|transcend\.io|usercontent|zdassets|cloudinary|fastly|jsdelivr|unpkg)/i
const GENERIC = new Set(["the","and","of","for","inc","llc","ltd","corp","co","company","group","holdings","technologies","technology","solutions","services","systems","global","international","careers","jobs","team","hiring","talent"])
const ATS_DOMAIN_RE = BAD_HOST_RE

function nameTokens(name: string): string[] { return name.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter((t)=>t.length>=3&&!GENERIC.has(t)) }
function regHost(u: string){ try { return new URL(u).hostname.toLowerCase().replace(/^www\./,"") } catch { return null } }
function hostSlug(h: string){ const l=h.split("."); return (l.length>1?l.slice(0,-1):l).join("") }
function regDomain(h: string){ const l=h.split("."); return l.length>2 ? l.slice(-2).join(".") : h } // drop careers/karriar subdomain
const ok=(h:string|null,ch:string):h is string=>!!h&&h!==ch&&!BAD_HOST_RE.test(h)&&/\.[a-z]{2,}$/.test(h)&&h.length<=45

function fromJsonLd(html: string): string[] {
  const urls: string[] = []
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any; try { data = JSON.parse(m[1].trim()) } catch { continue }
    const nodes: any[] = []; const push=(x:any)=>{ if(x&&typeof x==="object") nodes.push(x) }
    if (Array.isArray(data)) data.forEach(push); else { push(data); if (Array.isArray(data["@graph"])) data["@graph"].forEach(push) }
    for (const n of nodes) { const org=n.hiringOrganization||(String(n["@type"]||"").includes("Organization")?n:null); if(!org) continue
      if (typeof org.url==="string") urls.push(org.url)
      const sa=org.sameAs; if(Array.isArray(sa)) urls.push(...sa.filter((s:any)=>typeof s==="string")); else if(typeof sa==="string") urls.push(sa) }
  }
  return urls
}
// High-confidence only: JSON-LD hiringOrganization.url (the company's declared
// site), or an outbound host whose slug matches a company-name token. The loose
// "any single outbound / og host" fallbacks are deliberately dropped — on
// link-heavy corporate pages they grabbed vendor domains (cisco/csod/findly).
function extractDomain(html: string, ch: string, name: string): string | null {
  const tokens = nameTokens(name)
  const nameMatch = (h: string) => tokens.some((t) => hostSlug(h).includes(t) || (hostSlug(h).length >= 4 && t.includes(hostSlug(h))))
  // JSON-LD hiringOrganization — trusted even without a name-token match.
  for (const u of fromJsonLd(html)) { const h = regHost(u); if (ok(h, ch)) return regDomain(h) }
  const hosts = new Set<string>()
  for (const m of html.matchAll(/(?:property|rel|name)=["'](?:og:url|canonical|og:image|twitter:image)["'][^>]*?(?:content|href)=["'](https?:\/\/[^"']+)/gi)) { const h = regHost(m[1]); if (ok(h, ch)) hosts.add(h) }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) { const h = regHost(m[0]); if (ok(h, ch)) hosts.add(h) }
  const named = [...hosts].filter(nameMatch)
  if (named.length) return regDomain(named.sort((a, b) => a.length - b.length)[0]!)
  return null
}
function firstJobUrl(html: string, ch: string): string | null {
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) { const u=m[0]; const h=regHost(u)
    try { if (h===ch && /\/(jobs?|j|postings?|opportunit|position)\/[^/]+|\/[0-9a-f]{6,}/i.test(new URL(u).pathname)) return u } catch {} }
  return null
}
async function hasLogoMark(domain: string): Promise<boolean> {
  try { const r=await fetch(`https://img.logo.dev/${encodeURIComponent(domain)}?token=${LOGO_TOKEN}&size=128&format=png&fallback=404`,{signal:AbortSignal.timeout(6000)})
    if(r.status!==200||!(r.headers.get("content-type")??"").startsWith("image/")) return false
    return (await r.arrayBuffer()).byteLength>=700 } catch { return false }
}
async function homepageOwns(domain: string, name: string): Promise<boolean> {
  const tokens=nameTokens(name); if(!tokens.length) return false
  const distinctive=[...tokens].sort((a,b)=>b.length-a.length)[0]!; if(distinctive.length<4) return false
  for (const url of [`https://${domain}`,`https://www.${domain}`]) {
    try { const r=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(7000),headers:{"User-Agent":"Mozilla/5.0 (compatible; Hireoven/1.0)"}})
      if(!r.ok) continue; if(!/text\/html|xml/i.test(r.headers.get("content-type")??"")) continue
      const hay=(await r.text()).slice(0,200000).toLowerCase().replace(/<[^>]+>/g," ").replace(/[^a-z0-9]+/g," ")
      if(hay.includes(distinctive)) return true } catch {}
  }
  return false
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  // Canonical index (real-domain active rows) for merge-if-exists.
  const { rows: canonRows } = await pool.query<{id:string;domain:string}>(
    `SELECT id, domain FROM companies WHERE is_active AND domain ~ '^[a-z0-9.-]+\\.[a-z]{2,}$' AND domain !~ '(-tenant|placeholder|discovered|:wd[0-9]|myworkdayjobs|bamboohr\\.com|greenhouse|lever\\.co|smartrecruiters|workable|icims|oraclecloud|jazzhr)'`)
  const canonByDomain = new Map(canonRows.map((c)=>[c.domain,c.id]))

  const { rows } = await pool.query<{id:string;name:string;domain:string;careers_url:string}>(
    `SELECT c.id, c.name, c.domain, c.careers_url FROM companies c
     JOIN jobs j ON j.company_id=c.id AND j.is_active=true
     WHERE c.is_active AND c.careers_url ~ '^https?://'
       AND c.domain ~ '(greenhouse|lever\\.co|ashbyhq|smartrecruiters|workable|-tenant)'
       AND c.careers_url !~ '(adzuna|linkedin|indeed)'
       AND (c.logo_url IS NULL OR c.logo_url='')
     GROUP BY c.id ORDER BY count(j.id) DESC LIMIT $1`, [LIMIT])
  console.log(`\ncandidates: ${rows.length} | canonical index: ${canonByDomain.size} | ${DRY_RUN?"DRY RUN":"APPLYING"}\n`)

  const { chromium } = await import("playwright")
  const browser: Browser = await chromium.launch({ headless: true })
  const render = async (url: string): Promise<string|null> => {
    let ctx,page; try { ctx=await browser.newContext({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"})
      page=await ctx.newPage(); await page.route("**/*",(r)=>(["image","media","font"].includes(r.request().resourceType())?r.abort():r.continue()))
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:20000}); try{await page.waitForLoadState("networkidle",{timeout:6000})}catch{}
      return await page.content() } catch { return null } finally { try{await page?.close()}catch{}; try{await ctx?.close()}catch{} }
  }

  let set=0,unverified=0,noExtract=0,err=0
  let i=0
  async function worker() {
    while (i<rows.length) {
      const c=rows[i++]!; const ch=regHost(c.careers_url)??""
      const html=await render(c.careers_url)
      if(!html){ err++; continue }
      let d=extractDomain(html,ch,c.name)
      if(!d){ const ju=firstJobUrl(html,ch); if(ju){ const jh=await render(ju); if(jh) d=extractDomain(jh,ch,c.name) } }
      if(!d){ noExtract++; continue }
      if(!(await homepageOwns(d,c.name)) || !(await hasLogoMark(d))){ unverified++; console.log(`  ⊘ ${c.name.slice(0,26).padEnd(26)} -> ${d} (unverified)`); continue }
      // SET-only: set the correct logo_url, and adopt the domain only if free
      // (collision guard). Even a dupe gets the right LOGO this way; job-level
      // consolidation is left to the name-corroborated auto-merger.
      const dupe = canonByDomain.has(d) && canonByDomain.get(d) !== c.id
      set++; console.log(`  ✓ ${c.name.slice(0,26).padEnd(26)} -> SET ${d}${dupe ? " (logo only; canonical exists)" : ""}`)
      if(APPLY){ const logo=`https://img.logo.dev/${d}?token=${LOGO_TOKEN}&size=256&format=png`
        try{ await pool.query(`UPDATE companies SET logo_url=$2, domain=CASE WHEN NOT EXISTS(SELECT 1 FROM companies x WHERE x.domain=$1 AND x.id<>companies.id) THEN $1 ELSE companies.domain END, updated_at=now() WHERE id=$3`,[d,logo,c.id]) }
        catch(e){ if((e as any).code!=="23505") console.log(`     ✗ ${(e as Error).message}`) } }
    }
  }
  await Promise.all(Array.from({length:CONC},worker))
  await browser.close()
  console.log(`\n── set ${set} | unverified ${unverified} | no-extract ${noExtract} | render-err ${err}`)
  console.log(`   fixed ${set}/${rows.length} = ${((set/rows.length)*100).toFixed(0)}%  ${DRY_RUN?"(dry run)":""}`)
  await pool.end()
}
main().catch((e)=>{console.error(e);process.exit(1)})
