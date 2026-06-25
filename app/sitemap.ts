import type { MetadataRoute } from "next"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyParam, companySlug, jobsAtPath, salariesPath } from "@/lib/seo/company-seo"
import { industrySlug } from "@/lib/h1b/leaderboard"
import { getFeaturedSocRoles } from "@/lib/salaries/soc-roles"

const SALARY_TOP_STATES = ["CA", "TX", "NY", "WA", "NJ", "MA", "IL", "GA", "PA", "VA"]

export const dynamic = "force-dynamic"

const LEADERBOARD_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/features`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    { url: `${base}/extension`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/companies`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
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
        `SELECT id, updated_at FROM jobs WHERE is_active = true AND ${sqlPublishedJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")} ORDER BY first_detected_at DESC NULLS LAST LIMIT 1000`
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

    const companyRoutes: MetadataRoute.Sitemap = companiesResult.rows.map((c) => ({
      url: `${base}/companies/${c.id}`, lastModified: new Date(c.updated_at), changeFrequency: "daily", priority: 0.7,
    }))

    const sponsorRoutes: MetadataRoute.Sitemap = companiesResult.rows
      .filter((c) => c.sponsors_h1b || (c.h1b_sponsor_count_1yr ?? 0) > 0)
      .map((c) => ({ url: `${base}/h1b-sponsors/${companyParam(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.75 }))

    const jobsAtRoutes: MetadataRoute.Sitemap = companiesResult.rows
      .filter((c) => (c.job_count ?? 0) > 0)
      .map((c) => ({ url: `${base}${jobsAtPath(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "daily" as const, priority: 0.7 }))

    const scorecardRoutes: MetadataRoute.Sitemap = [...companiesResult.rows]
      .filter((c) => c.sponsors_h1b || (c.h1b_sponsor_count_1yr ?? 0) > 0)
      .sort((a, b) => (b.sponsorship_confidence ?? 0) - (a.sponsorship_confidence ?? 0))
      .slice(0, 2000)
      .map((c) => ({ url: `${base}/h1b-sponsors/${companyParam(c.id, c.name)}/scorecard`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.6 }))

    const salaryRoutes: MetadataRoute.Sitemap = companiesResult.rows
      .filter((c) => (c.job_count ?? 0) >= 5)
      .map((c) => ({ url: `${base}${salariesPath(c.id, c.name)}`, lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.7 }))

    const industryCounts = new Map<string, number>()
    for (const c of companiesResult.rows) {
      if (c.industry && c.sponsors_h1b && (c.h1b_sponsor_count_1yr ?? 0) > 0) {
        industryCounts.set(c.industry, (industryCounts.get(c.industry) ?? 0) + 1)
      }
    }
    const industryRoutes: MetadataRoute.Sitemap = [...industryCounts.entries()]
      .filter(([, n]) => n >= 5)
      .map(([industry]) => ({ url: `${base}/h1b-sponsors/industry/${companySlug(industry)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65 }))

    const leaderboardIndustryRoutes: MetadataRoute.Sitemap = [...industryCounts.entries()]
      .filter(([, n]) => n >= 5)
      .map(([industry]) => ({ url: `${base}/h1b-sponsors/leaderboard/by-industry/${industrySlug(industry)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.6 }))

    const cityRoutes: MetadataRoute.Sitemap = citiesResult.rows.map((c) => ({
      url: `${base}/h1b-sponsors/in/${companySlug(c.city)}-${c.state.toLowerCase()}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65,
    }))

    const roleRoutes: MetadataRoute.Sitemap = socsResult.rows
      .filter((s) => s.soc_title)
      .map((s) => ({ url: `${base}/h1b-sponsors/role/${companySlug(s.soc_title)}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.65 }))

    const jobRoutes: MetadataRoute.Sitemap = jobsResult.rows.map((j) => ({
      url: `${base}/jobs/${j.id}`, lastModified: new Date(j.updated_at), changeFrequency: "weekly", priority: 0.6,
    }))

    const salaryRoles = await getFeaturedSocRoles().catch(() => [])
    const salaryRoleRoutes: MetadataRoute.Sitemap = salaryRoles.flatMap((r) => [
      { url: `${base}/h1b-salaries/by-role/${r.slug}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.7 },
      ...SALARY_TOP_STATES.map((s) => ({
        url: `${base}/h1b-salaries/by-role/${r.slug}/by-state/${s}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ])

    return [...staticRoutes, ...companyRoutes, ...sponsorRoutes, ...industryRoutes, ...leaderboardIndustryRoutes, ...cityRoutes, ...roleRoutes, ...jobsAtRoutes, ...salaryRoutes, ...scorecardRoutes, ...salaryRoleRoutes, ...jobRoutes]
  } catch {
    return staticRoutes
  }
}
