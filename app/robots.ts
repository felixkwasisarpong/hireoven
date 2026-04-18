import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/companies", "/companies/", "/jobs/", "/privacy", "/terms"],
        disallow: ["/dashboard", "/dashboard/", "/admin", "/admin/", "/api/", "/auth/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
