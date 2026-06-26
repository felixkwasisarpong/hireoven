import type { MetadataRoute } from "next"
import { siteBaseUrl } from "@/lib/seo/site-url"

export default function robots(): MetadataRoute.Robots {
  // Same guard as the sitemap: a blank NEXT_PUBLIC_APP_URL would make this a relative
  // (invalid) sitemap reference, which Google ignores.
  const base = siteBaseUrl()

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/companies", "/companies/", "/h1b-sponsors", "/h1b-sponsors/", "/jobs/", "/jobs-at/", "/salaries/", "/privacy", "/terms"],
        disallow: ["/dashboard", "/dashboard/", "/admin", "/admin/", "/api/", "/auth/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
