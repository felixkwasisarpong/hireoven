/**
 * Scrape Greenhouse's authenticated MyGreenhouse job search with a dedicated
 * Playwright profile. The normal Greenhouse job board API remains public, but
 * my.greenhouse.io search requires a signed-in candidate session.
 *
 * Usage:
 *   npx tsx scripts/scrape-my-greenhouse.ts --query=software
 *   npx tsx scripts/scrape-my-greenhouse.ts --url='https://my.greenhouse.io/jobs?query=fintech&location=United%20States'
 *   npx tsx scripts/scrape-my-greenhouse.ts --query=software --execute
 */

import { loadEnvConfig } from "@next/env"
import { chromium, type Page } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

loadEnvConfig(process.cwd())

type LinkHit = {
  href: string
  text: string
  context: string
}

type GreenhouseHit = {
  slug: string
  sourceUrl: string
  companyNameGuess: string | null
  examples: LinkHit[]
}

type MyGreenhouseJobPost = {
  id?: number | string
  title?: string
  companyName?: string
  publicUrl?: string
  viewJobPath?: string
  locations?: string[]
}

type MyGreenhousePayload = {
  props?: {
    page?: number
    moreResultsAvailable?: boolean
    jobPosts?: MyGreenhouseJobPost[]
  }
}

type ExistingCompanyRow = {
  id: string
  name: string | null
  domain: string | null
  is_active: boolean | null
  status: string | null
  duplicate_of_company_id: string | null
  created_at: Date | string
}

function argValue(name: string, fallback: string): string {
  const prefix = `${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function parseIntegerArg(name: string, fallback: number): number {
  const parsed = Number.parseInt(argValue(name, String(fallback)), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const urlArg = argValue("--url", "")
const query = argValue("--query", (() => {
  if (!urlArg) return "software"
  try {
    return new URL(urlArg).searchParams.get("query") ?? "jobs"
  } catch {
    return "jobs"
  }
})())
const profileDir = argValue("--profile", "/tmp/hireoven-my-greenhouse-profile")
const maxScrolls = parseIntegerArg("--max-scrolls", 120)
const maxPages = parseIntegerArg("--max-pages", 100)
const pageDelayMs = parseIntegerArg("--page-delay-ms", 600)
const waitMs = parseIntegerArg("--wait-ms", 10 * 60 * 1000)
const execute = process.argv.includes("--execute")
const headless = process.argv.includes("--headless")
const outputLabel = (() => {
  const parts = [query]
  if (urlArg) {
    try {
      const params = new URL(urlArg).searchParams
      const location = params.get("country_short_name") ?? params.get("location")
      if (location) parts.push(location)
    } catch {
      // Keep the query-only label if URL parsing fails; validation happens below.
    }
  }
  return parts.join("-").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()
})()
const outputBase = argValue(
  "--out",
  join(process.cwd(), "scripts/output", `my-greenhouse-${outputLabel}-${Date.now()}`),
)

function cleanSlug(slug: string | null): string | null {
  if (!slug) return null
  const cleaned = decodeURIComponent(slug).trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(cleaned) ? cleaned : null
}

function slugFromUrl(input: string): string | null {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split("/").filter(Boolean)

    if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
      return cleanSlug(parts[0] ?? null)
    }

    if (host === "my.greenhouse.io" && parts[1] === "jobs") {
      return cleanSlug(parts[0] ?? null)
    }

    if (host === "boards-api.greenhouse.io") {
      const boardIdx = parts.findIndex((part) => part === "boards")
      return cleanSlug(boardIdx >= 0 ? parts[boardIdx + 1] : null)
    }

    const embedFor = url.searchParams.get("for")
    if (host.endsWith(".greenhouse.io") && embedFor) return cleanSlug(embedFor)
  } catch {
    return null
  }
  return null
}

function slugFromPath(input: string | null | undefined): string | null {
  if (!input) return null
  const parts = input.split("?")[0].split("/").filter(Boolean)
  if (parts[1] === "jobs") return cleanSlug(parts[0] ?? null)
  return null
}

function guessCompanyName(hit: LinkHit): string | null {
  const candidates = [hit.text, hit.context]
  for (const candidate of candidates) {
    const lines = candidate
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) {
      if (line.length < 2 || line.length > 120) continue
      if (/^(apply|view|save|saved|share|software|jobs?|remote|hybrid)$/i.test(line)) continue
      if (/\b(engineer|developer|manager|designer|analyst|director|intern|lead|specialist|consultant)\b/i.test(line)) {
        continue
      }
      return line
    }
  }
  return null
}

function mergeHits(target: Map<string, GreenhouseHit>, links: LinkHit[]) {
  for (const link of links) {
    const slug = slugFromUrl(link.href)
    if (!slug) continue
    const existing = target.get(slug)
    if (existing) {
      if (existing.examples.length < 5) existing.examples.push(link)
      if (!existing.companyNameGuess) existing.companyNameGuess = guessCompanyName(link)
      continue
    }
    target.set(slug, {
      slug,
      sourceUrl: `https://boards.greenhouse.io/${slug}`,
      companyNameGuess: guessCompanyName(link),
      examples: [link],
    })
  }
}

function mergeJobPosts(
  target: Map<string, GreenhouseHit>,
  posts: MyGreenhouseJobPost[],
  seenJobs: Set<string>,
): { newJobs: number; newSlugs: number } {
  let newJobs = 0
  let newSlugs = 0

  for (const post of posts) {
    const jobKey = post.id == null ? `${post.viewJobPath ?? ""}:${post.title ?? ""}` : String(post.id)
    if (jobKey && !seenJobs.has(jobKey)) {
      seenJobs.add(jobKey)
      newJobs += 1
    }

    const slug = slugFromUrl(post.publicUrl ?? "") ?? slugFromPath(post.viewJobPath)
    if (!slug) continue

    const link: LinkHit = {
      href: post.publicUrl ?? `https://my.greenhouse.io${post.viewJobPath ?? ""}`,
      text: post.title ?? "",
      context: [post.companyName, post.title, ...(post.locations ?? [])].filter(Boolean).join("\n"),
    }

    const existing = target.get(slug)
    if (existing) {
      if (existing.examples.length < 5) existing.examples.push(link)
      if (!existing.companyNameGuess && post.companyName) existing.companyNameGuess = post.companyName
      continue
    }

    target.set(slug, {
      slug,
      sourceUrl: `https://boards.greenhouse.io/${slug}`,
      companyNameGuess: post.companyName?.trim() || null,
      examples: [link],
    })
    newSlugs += 1
  }

  return { newJobs, newSlugs }
}

async function collectLinks(page: Page): Promise<LinkHit[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => {
      let parent: Element | null = anchor
      for (let i = 0; i < 4 && parent?.parentElement; i += 1) {
        parent = parent.parentElement
      }
      const rawText = anchor.innerText || anchor.getAttribute("aria-label") || anchor.textContent || ""
      const rawContext = parent?.textContent || ""
      const text = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean).join("\n")
      const context = rawContext.split(/\n+/).map((line) => line.trim()).filter(Boolean).join("\n")
      return {
        href: new URL(anchor.getAttribute("href") ?? "", window.location.href).href,
        text,
        context: context.slice(0, 1200),
      }
    })
  })
}

async function waitForLogin(page: Page) {
  const deadline = Date.now() + waitMs
  let announced = false
  while (Date.now() < deadline) {
    const url = page.url()
    const body = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "")
    const linkCount = await page.locator("a[href]").count().catch(() => 0)
    const signedIn = !/\/users\/sign_in\b/.test(url) && linkCount > 3 && !/sign in to greenhouse/i.test(body)
    if (signedIn) return
    if (!announced) {
      console.log("[my-greenhouse] Browser is open. Log in there; scraping starts automatically after login.")
      announced = true
    }
    await page.waitForTimeout(2000)
  }
  throw new Error(`Timed out after ${Math.round(waitMs / 1000)}s waiting for Greenhouse login`)
}

async function scrape(page: Page): Promise<GreenhouseHit[]> {
  const hits = new Map<string, GreenhouseHit>()
  let stableRounds = 0
  let previousCount = 0
  let previousHeight = 0

  for (let i = 0; i < maxScrolls; i += 1) {
    mergeHits(hits, await collectLinks(page))

    const loadMore = page.getByRole("button", { name: /load more|show more|more jobs|see more/i }).first()
    if (await loadMore.isVisible().catch(() => false)) {
      await loadMore.click().catch(() => undefined)
      await page.waitForTimeout(1500)
    }

    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    const count = hits.size
    if (count === previousCount && height === previousHeight) stableRounds += 1
    else stableRounds = 0

    if (i % 5 === 0 || count !== previousCount) {
      console.log(`[my-greenhouse] scroll=${i + 1}/${maxScrolls} greenhouse_slugs=${count}`)
    }

    if (stableRounds >= 8) break
    previousCount = count
    previousHeight = height

    await page.mouse.wheel(0, 2400)
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.5, 900)))
    await page.waitForTimeout(1200)
  }

  mergeHits(hits, await collectLinks(page))
  return Array.from(hits.values()).sort((a, b) => a.slug.localeCompare(b.slug))
}

function searchUrl(pageNumber: number): string {
  const url = urlArg ? new URL(urlArg) : new URL("https://my.greenhouse.io/jobs")
  if (url.hostname !== "my.greenhouse.io" || url.pathname !== "/jobs") {
    throw new Error(`--url must be a https://my.greenhouse.io/jobs URL, got ${url.toString()}`)
  }
  if (!url.searchParams.get("query")) url.searchParams.set("query", query)
  url.searchParams.delete("page")
  if (pageNumber > 1) url.searchParams.set("page", String(pageNumber))
  return url.toString()
}

function isRealDomain(domain: string | null): boolean {
  return Boolean(domain)
    && !/greenhouse|placeholder|discovered|tenant|builtin-discovery|adzuna-|dice-/i.test(domain ?? "")
}

function chooseCompanyRow(rows: ExistingCompanyRow[]): ExistingCompanyRow | null {
  const candidates = rows.some((row) => row.duplicate_of_company_id == null)
    ? rows.filter((row) => row.duplicate_of_company_id == null)
    : rows

  return [...candidates].sort((a, b) => {
    const aActive = a.is_active === true && a.status === "active" ? 0 : 1
    const bActive = b.is_active === true && b.status === "active" ? 0 : 1
    if (aActive !== bActive) return aActive - bActive

    const aReal = isRealDomain(a.domain) ? 0 : 1
    const bReal = isRealDomain(b.domain) ? 0 : 1
    if (aReal !== bReal) return aReal - bReal

    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })[0] ?? null
}

async function getInertiaVersion(page: Page): Promise<string | null> {
  const raw = await page.locator("[data-page]").first().getAttribute("data-page").catch(() => null)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { version?: unknown }
      if (typeof parsed.version === "string" && parsed.version) return parsed.version
    } catch {
      // Fall through to the response-based path below.
    }
  }

  let version: string | null = null
  const responsePromise = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      page.off("response", onResponse)
      resolve()
    }, 10_000)

    async function onResponse(response: import("playwright").Response) {
      const contentType = response.headers()["content-type"] ?? ""
      if (!response.url().startsWith("https://my.greenhouse.io/jobs") || !contentType.includes("application/json")) return
      clearTimeout(timeout)
      page.off("response", onResponse)
      try {
        const payload = JSON.parse(await response.text()) as { version?: unknown }
        if (typeof payload.version === "string") version = payload.version
      } catch {
        // Ignore parse errors; caller can fall back to DOM scrolling.
      }
      resolve()
    }

    page.on("response", onResponse)
  })

  await page.goto(searchUrl(1), { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined)
  await responsePromise
  return version
}

async function fetchSearchPayload(
  page: Page,
  pageNumber: number,
  inertiaVersion: string,
): Promise<MyGreenhousePayload | null> {
  const url = searchUrl(pageNumber)
  const response = await page.request.get(url, {
    headers: {
      "X-Inertia": "true",
      "X-Inertia-Version": inertiaVersion,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/html, application/xhtml+xml",
    },
    timeout: 30_000,
  }).catch(() => null)

  if (!response || !response.ok()) return null
  const contentType = response.headers()["content-type"] ?? ""
  if (!contentType.includes("application/json")) return null
  try {
    return JSON.parse(await response.text()) as MyGreenhousePayload
  } catch {
    return null
  }
}

async function scrapePaginatedJson(page: Page): Promise<GreenhouseHit[]> {
  const inertiaVersion = await getInertiaVersion(page)
  if (!inertiaVersion) {
    console.log("[my-greenhouse] could not read Inertia version; skipping paginated JSON")
    return []
  }

  const hits = new Map<string, GreenhouseHit>()
  const seenJobs = new Set<string>()
  let noNewJobPages = 0
  let totalPosts = 0

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const payload = await fetchSearchPayload(page, pageNumber, inertiaVersion)
    const posts = payload?.props?.jobPosts ?? []
    const more = payload?.props?.moreResultsAvailable ?? false
    if (!payload || posts.length === 0) {
      console.log(`[my-greenhouse] page=${pageNumber} no JSON posts; stopping paginated fetch`)
      break
    }

    totalPosts += posts.length
    const before = hits.size
    const { newJobs } = mergeJobPosts(hits, posts, seenJobs)
    noNewJobPages = newJobs === 0 ? noNewJobPages + 1 : 0

    console.log(
      `[my-greenhouse] page=${pageNumber} posts=${posts.length} total_jobs=${seenJobs.size} greenhouse_slugs=${hits.size} new_slugs=${hits.size - before} more=${more}`,
    )

    if (!more || noNewJobPages >= 5) break
    await page.waitForTimeout(pageDelayMs)
  }

  console.log(`[my-greenhouse] paginated posts seen=${totalPosts} unique_jobs=${seenJobs.size}`)
  return Array.from(hits.values()).sort((a, b) => a.slug.localeCompare(b.slug))
}

async function enroll(hits: GreenhouseHit[]) {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const { enrollTenantAsCompany } = await import("@/lib/discovery/enroll-tenant-as-company")
  const pool = getPostgresPool()
  let alreadyClaimable = 0
  let reactivated = 0
  let promotedDuplicate = 0
  let created = 0
  let linked = 0
  let failed = 0

  for (const hit of hits) {
    try {
      const existing = await pool.query<ExistingCompanyRow>(
        `SELECT id, name, domain, is_active, status, duplicate_of_company_id, created_at
           FROM companies
          WHERE ats_type = 'greenhouse'
            AND ats_identifier = $1
          ORDER BY created_at ASC`,
        [hit.slug],
      )
      const selected = chooseCompanyRow(existing.rows)

      if (selected) {
        const wasClaimable = selected.duplicate_of_company_id == null
          && selected.is_active === true
          && selected.status === "active"

        await pool.query(
          `UPDATE companies
              SET duplicate_of_company_id = NULL,
                  is_active = true,
                  status = 'active',
                  ats_type = 'greenhouse',
                  ats_identifier = $2,
                  careers_url = $3,
                  name = COALESCE(NULLIF($4, ''), name),
                  next_harvest_at = now(),
                  updated_at = now()
            WHERE id = $1`,
          [selected.id, hit.slug, hit.sourceUrl, hit.companyNameGuess ?? null],
        )

        const duplicateIds = existing.rows.map((row) => row.id).filter((id) => id !== selected.id)
        if (duplicateIds.length > 0) {
          await pool.query(
            `UPDATE companies
                SET duplicate_of_company_id = $1,
                    is_active = false,
                    next_harvest_at = NULL,
                    updated_at = now()
              WHERE id = ANY($2::uuid[])`,
            [selected.id, duplicateIds],
          )
        }

        await pool.query(
          `INSERT INTO ats_tenants
             (ats_type, ats_identifier, source_url, source_type,
              company_name_guess, confidence, job_count, status,
              last_checked_at, company_id)
           VALUES ('greenhouse', $1, $2, 'my-greenhouse-search',
                   $3, 80, 0, 'enrolled', now(), $4)
           ON CONFLICT (ats_type, ats_identifier) DO UPDATE
             SET source_url = COALESCE(EXCLUDED.source_url, ats_tenants.source_url),
                 source_type = COALESCE(EXCLUDED.source_type, ats_tenants.source_type),
                 company_name_guess = COALESCE(EXCLUDED.company_name_guess, ats_tenants.company_name_guess),
                 confidence = GREATEST(ats_tenants.confidence, EXCLUDED.confidence),
                 status = 'enrolled',
                 company_id = EXCLUDED.company_id,
                 last_checked_at = now(),
                 updated_at = now()`,
          [hit.slug, hit.sourceUrl, hit.companyNameGuess ?? hit.slug, selected.id],
        )

        if (wasClaimable) alreadyClaimable += 1
        else if (selected.duplicate_of_company_id == null) reactivated += 1
        else promotedDuplicate += 1
        continue
      }

      const result = await enrollTenantAsCompany(pool, {
        atsType: "greenhouse",
        atsIdentifier: hit.slug,
        confidence: 80,
        sourceType: "my-greenhouse-search",
        sourceUrl: hit.sourceUrl,
        companyNameGuess: hit.companyNameGuess ?? hit.slug,
        domainGuess: `${hit.slug}.greenhouse-tenant`,
      })
      await pool.query(
        `UPDATE companies
            SET duplicate_of_company_id = NULL,
                is_active = true,
                status = 'active',
                ats_type = 'greenhouse',
                ats_identifier = $2,
                careers_url = $3,
                next_harvest_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [result.companyId, hit.slug, hit.sourceUrl],
      )
      if (result.created) created += 1
      else linked += 1
    } catch (error) {
      failed += 1
      if (failed <= 10) {
        console.warn(`[my-greenhouse] enroll failed for ${hit.slug}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const slugs = hits.map((hit) => hit.slug)
  const verification = await pool.query<{ slug: string; id: string | null; next_harvest_at: Date | null }>(
    `SELECT input.slug, c.id, c.next_harvest_at
       FROM unnest($1::text[]) AS input(slug)
       LEFT JOIN companies c
         ON c.ats_type = 'greenhouse'
        AND c.ats_identifier = input.slug
        AND c.duplicate_of_company_id IS NULL
        AND c.is_active = true
        AND c.status = 'active'`,
    [slugs],
  )
  const missing = verification.rows.filter((row) => !row.id)
  const dueNow = verification.rows.filter((row) =>
    row.id && (!row.next_harvest_at || new Date(row.next_harvest_at) <= new Date())
  ).length

  await pool.end()
  console.log(`[my-greenhouse] enrolled ${JSON.stringify({
    totalSlugs: hits.length,
    alreadyClaimable,
    reactivated,
    promotedDuplicate,
    created,
    linked,
    failed,
    activeCanonicalGreenhouseRows: verification.rows.length - missing.length,
    missing: missing.length,
    dueNow,
  })}`)
  if (missing.length > 0) {
    console.log(`[my-greenhouse] missing slugs: ${missing.map((row) => row.slug).join(", ")}`)
  }
}

async function main() {
  mkdirSync(join(process.cwd(), "scripts/output"), { recursive: true })

  const url = searchUrl(1)
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 1000 },
  })
  const page = context.pages()[0] ?? await context.newPage()

  console.log(`[my-greenhouse] opening ${url}`)
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await waitForLogin(page)

  let hits = await scrapePaginatedJson(page)
  if (hits.length === 0) {
    console.log("[my-greenhouse] paginated JSON yielded no slugs; falling back to DOM scrolling")
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
    hits = await scrape(page)
  }
  const jsonPath = `${outputBase}.json`
  const csvPath = `${outputBase}.csv`
  writeFileSync(jsonPath, JSON.stringify({ query, url, scrapedAt: new Date().toISOString(), hits }, null, 2))
  writeFileSync(
    csvPath,
    ["slug,company_name_guess,source_url"].concat(
      hits.map((hit) =>
        [
          hit.slug,
          `"${(hit.companyNameGuess ?? "").replace(/"/g, "\"\"")}"`,
          hit.sourceUrl,
        ].join(","),
      ),
    ).join("\n") + "\n",
  )

  console.log(`[my-greenhouse] saved ${hits.length} greenhouse slugs`)
  console.log(`[my-greenhouse] json ${jsonPath}`)
  console.log(`[my-greenhouse] csv  ${csvPath}`)

  if (execute) await enroll(hits)
  else console.log("[my-greenhouse] dry run only. Re-run with --execute to enroll these tenants.")

  await context.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
