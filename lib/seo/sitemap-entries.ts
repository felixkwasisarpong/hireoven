import type { MetadataRoute } from "next"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyParam, companySlug, jobsAtPath, salariesPath } from "@/lib/seo/company-seo"
import { industrySlug } from "@/lib/h1b/leaderboard"
import { getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import { siteBaseUrl } from "@/lib/seo/site-url"

export { siteBaseUrl }

// Google caps a single sitemap at 50,000 URLs. We routinely exceed that, so the
// routes split entries into chunks and serve a sitemap index. Keep headroom under
// the hard limit so a growth spike between deploys can't push a chunk over.
export const SITEMAP_CHUNK = 45000

// Cap on individual /jobs/[id] URLs in the sitemap. Job detail pages are the core
// long-tail SEO surface, so we index far more than the old 1000, but keep a bound:
// the query is index-backed (idx_jobs_first_detected_at) and stops once it has this
// many matching rows, so it's a bounded index walk (not a full scan) on the small
// prod PG, and stays under Google's 50k-per-sitemap limit. Ordered newest-first, so
// the freshest — and most link-worthy — roles are always the ones included.
export const SITEMAP_JOB_LIMIT = 25000

export type SitemapEntry = MetadataRoute.Sitemap[number]

const SALARY_TOP_STATES = ["CA", "TX", "NY", "WA", "NJ", "MA", "IL", "GA", "PA", "VA"]

const LEADERBOARD_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]

async function buildEntries(): Promise<{ entries: SitemapEntry[]; ok: boolean }> {
  const base = siteBaseUrl()

  const staticRoutes: SitemapEntry[] = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/features`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    { url: `${base}/extension`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/companies`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/report`, lastModified: new Date(), changeFrequency: "daily", priority: 0.85 },
    { url: `${base}/h1b-sponsors`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/h1b-sponsors/leaderboard`, lastModified: new Date(), changeFrequency: "daily", priority: 0.85 },
    { url: `${base}/h1b-sponsors/leaderboard/no-recent-layoffs`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/h1b-sponsors/cap-exempt`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/h1b-sponsors/e-verify`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/h1b-sponsors/lottery-rescue`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/h1b-sponsors/leaderboard/methodology`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/h1b-salaries`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    ...LEADERBOARD_STATES.map((s) => ({
      url: `${base}/h1b-sponsors/leaderboard/by-state/${s}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    { url: `${base}/embed`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/embed/docs`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.2 },
  ]

  try {
    const pool = getPostgresPool()

    const [companiesResult, jobsResult, citiesResult, socsResult] = await Promise.all([
      pool.query<{ id: string; name: string; updated_at: string; sponsors_h1b: boolean | null; h1b_sponsor_count_1yr: number | null; sponsorship_confidence: number | null; job_count: number | null; industry: string | null }>(
        `SELECT id, name, updated_at, sponsors_h1b, h1b_sponsor_count_1yr, sponsorship_confidence, job_count, industry FROM companies WHERE is_active = true ORDER BY job_count DESC`
      ),
      pool.query<{ id: string; updated_at: string }>(
        `SELECT id, updated_at FROM jobs WHERE is_active = true AND ${sqlPublishedJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")} ORDER BY first_detected_at DESC NULLS LAST LIMIT ${SITEMAP_JOB_LIMIT}`
      ),
      pool.query<{ city: string; state: string }>(
        `SELECT worksite_city AS city, worksite_state_abbr AS state FROM lca_records
          WHERE worksite_city IS NOT NULL AND worksite_state_abbr IS NOT NULL
          GROUP BY 1, 2 HAVING count(*) >= 100 ORDER BY count(*) DESC LIMIT 200`
      ),
      pool.query<{ soc_title: string }>(
        `SELECT mode() WITHIN GROUP (ORDER BY soc_title) AS soc_title FROM lca_records
          WHERE soc_code IS NOT NULL AND soc_title IS NOT NULL AND soc_title <> ''
          GROUP BY soc_code HAVING count(*) >= 50 ORDER BY count(*) DESC LIMIT 60`
      ),
    ])

    const companyRoutes: SitemapEntry[] = companiesResult.rows.map((c) => ({
      url: `${base}/companies/${c.id}`, lastModified: new Date(c.updated_at), changeFrequency: "daily", priority: 0.7,
    }))

    const sponsorRoutes: SitemapEntry[] = companiesResult.rows
      .filter((c) => c.sponsors_h1b || (c.h1b_sponsor_count_1yr ?? 0) > 0)
      .map((c) => ({ url: `${base}/h1b-sponsors/${companyParam(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.75 }))

    const jobsAtRoutes: SitemapEntry[] = companiesResult.rows
      .filter((c) => (c.job_count ?? 0) > 0)
      .map((c) => ({ url: `${base}${jobsAtPath(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "daily" as const, priority: 0.7 }))

    const scorecardRoutes: SitemapEntry[] = [...companiesResult.rows]
      .filter((c) => c.sponsors_h1b || (c.h1b_sponsor_count_1yr ?? 0) > 0)
      .sort((a, b) => (b.sponsorship_confidence ?? 0) - (a.sponsorship_confidence ?? 0))
      .slice(0, 2000)
      .map((c) => ({ url: `${base}/h1b-sponsors/${companyParam(c.id, c.name)}/scorecard`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.6 }))

    const salaryRoutes: SitemapEntry[] = companiesResult.rows
      .filter((c) => (c.job_count ?? 0) >= 5)
      .map((c) => ({ url: `${base}${salariesPath(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.7 }))

    const industryCounts = new Map<string, number>()
    for (const c of companiesResult.rows) {
      if (c.industry && c.sponsors_h1b && (c.h1b_sponsor_count_1yr ?? 0) > 0) {
        industryCounts.set(c.industry, (industryCounts.get(c.industry) ?? 0) + 1)
      }
    }
    const industryRoutes: SitemapEntry[] = [...industryCounts.entries()]
      .filter(([, n]) => n >= 5)
      .map(([industry]) => ({ url: `${base}/h1b-sponsors/industry/${companySlug(industry)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65 }))

    const leaderboardIndustryRoutes: SitemapEntry[] = [...industryCounts.entries()]
      .filter(([, n]) => n >= 5)
      .map(([industry]) => ({ url: `${base}/h1b-sponsors/leaderboard/by-industry/${industrySlug(industry)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.6 }))

    const cityRoutes: SitemapEntry[] = citiesResult.rows.map((c) => ({
      url: `${base}/h1b-sponsors/in/${companySlug(c.city)}-${c.state.toLowerCase()}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65,
    }))

    const roleRoutes: SitemapEntry[] = socsResult.rows
      .filter((s) => s.soc_title)
      .map((s) => ({ url: `${base}/h1b-sponsors/role/${companySlug(s.soc_title)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65 }))

    const jobRoutes: SitemapEntry[] = jobsResult.rows.map((j) => ({
      url: `${base}/jobs/${j.id}`, lastModified: new Date(j.updated_at), changeFrequency: "weekly", priority: 0.6,
    }))

    const salaryRoles = await getFeaturedSocRoles().catch(() => [])
    const salaryRoleRoutes: SitemapEntry[] = salaryRoles.flatMap((r) => [
      { url: `${base}/h1b-salaries/by-role/${r.slug}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.7 },
      ...SALARY_TOP_STATES.map((s) => ({
        url: `${base}/h1b-salaries/by-role/${r.slug}/by-state/${s}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ])

    return { entries: [...staticRoutes, ...companyRoutes, ...sponsorRoutes, ...industryRoutes, ...leaderboardIndustryRoutes, ...cityRoutes, ...roleRoutes, ...jobsAtRoutes, ...salaryRoutes, ...scorecardRoutes, ...salaryRoleRoutes, ...jobRoutes], ok: true }
  } catch {
    // DB unreachable (e.g. cold start). Return static-only but flag NOT ok so the
    // caller refuses to cache it or emit a truncated index — see getSitemapEntries.
    return { entries: staticRoutes, ok: false }
  }
}

// Build once per TTL window and share across the index + every chunk request, so a
// crawl that fetches the index and N children doesn't run the heavy companies scan
// N+1 times (the web box PG is small — see CLAUDE.md memory). Process-local cache.
// IMPORTANT: only successful (DB-backed) builds are cached. A degraded static-only
// build (DB cold start) must NOT poison the cache — otherwise the index would report
// 1 chunk and silently drop ~25k URLs (which is exactly what happened in prod).
const TTL_MS = 15 * 60 * 1000
let cache: { at: number; entries: SitemapEntry[] } | null = null

export async function getSitemapEntries(): Promise<{ entries: SitemapEntry[]; ok: boolean }> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return { entries: cache.entries, ok: true }
  const res = await buildEntries()
  if (res.ok) cache = { at: now, entries: res.entries }
  return res
}

export function sitemapChunkCount(total: number): number {
  return Math.max(1, Math.ceil(total / SITEMAP_CHUNK))
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!))
}

type SitemapDate = Date | string | number | undefined
function toIso(d: SitemapDate): string | null {
  if (d == null) return null
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Render the <sitemapindex> listing one child sitemap per chunk (absolute URLs). */
export function buildSitemapIndexXml(base: string, chunks: number, lastmod: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    Array.from({ length: chunks }, (_, i) =>
      `<sitemap><loc>${xmlEscape(`${base}/sitemap/${i}.xml`)}</loc><lastmod>${lastmod}</lastmod></sitemap>`
    ).join("\n") +
    `\n</sitemapindex>\n`
  )
}

/** Render a <urlset> for one chunk of entries. */
export function buildUrlsetXml(entries: SitemapEntry[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e) => {
        const lastmod = toIso(e.lastModified as SitemapDate)
        return (
          `<url><loc>${xmlEscape(String(e.url))}</loc>` +
          (lastmod ? `<lastmod>${lastmod}</lastmod>` : "") +
          (e.changeFrequency ? `<changefreq>${e.changeFrequency}</changefreq>` : "") +
          (e.priority != null ? `<priority>${e.priority}</priority>` : "") +
          `</url>`
        )
      })
      .join("\n") +
    `\n</urlset>\n`
  )
}
