import type { MetadataRoute } from "next"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/companies`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.2 },
  ]

  try {
    const pool = getPostgresPool()

    const [companiesResult, jobsResult] = await Promise.all([
      pool.query<{ id: string; updated_at: string }>(
        `SELECT id, updated_at FROM companies WHERE is_active = true ORDER BY job_count DESC`
      ),
      pool.query<{ id: string; updated_at: string }>(
        `SELECT id, updated_at FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa(
          "jobs"
        )} ORDER BY first_detected_at DESC NULLS LAST LIMIT 1000`
      ),
    ])

    const companyRoutes: MetadataRoute.Sitemap = companiesResult.rows.map(
      (c: { id: string; updated_at: string }) => ({
      url: `${base}/companies/${c.id}`,
      lastModified: new Date(c.updated_at),
      changeFrequency: "daily",
      priority: 0.7,
    })
    )

    const jobRoutes: MetadataRoute.Sitemap = jobsResult.rows.map(
      (j: { id: string; updated_at: string }) => ({
      url: `${base}/jobs/${j.id}`,
      lastModified: new Date(j.updated_at),
      changeFrequency: "weekly",
      priority: 0.6,
    })
    )

    return [...staticRoutes, ...companyRoutes, ...jobRoutes]
  } catch {
    return staticRoutes
  }
}
