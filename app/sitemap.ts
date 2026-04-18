import type { MetadataRoute } from "next"
import { createAdminClient } from "@/lib/supabase/admin"

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
    const supabase = createAdminClient()

    const [companiesResult, jobsResult] = await Promise.all([
      supabase
        .from("companies")
        .select("id, updated_at")
        .eq("is_active", true)
        .order("job_count", { ascending: false }),
      supabase
        .from("jobs")
        .select("id, updated_at")
        .eq("is_active", true)
        .order("first_detected_at", { ascending: false })
        .limit(1000),
    ])

    const companyRoutes: MetadataRoute.Sitemap = (companiesResult.data ?? []).map((c) => ({
      url: `${base}/companies/${c.id}`,
      lastModified: new Date(c.updated_at),
      changeFrequency: "daily",
      priority: 0.7,
    }))

    const jobRoutes: MetadataRoute.Sitemap = (jobsResult.data ?? []).map((j) => ({
      url: `${base}/jobs/${j.id}`,
      lastModified: new Date(j.updated_at),
      changeFrequency: "weekly",
      priority: 0.6,
    }))

    return [...staticRoutes, ...companyRoutes, ...jobRoutes]
  } catch {
    return staticRoutes
  }
}
