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
        // /api/og/ must stay crawlable: it serves the Open Graph share images. A specific
        // Allow overrides the broad /api/ Disallow via longest-match precedence, so social
        // scrapers (LinkedIn, Facebook, Twitter) can fetch the preview image while the rest
        // of /api/ stays blocked. Without this, shared job links show "Cannot display preview".
        allow: ["/", "/api/og/", "/companies", "/companies/", "/report", "/report/", "/h1b-sponsors", "/h1b-sponsors/", "/jobs/", "/jobs-at/", "/salaries/", "/privacy", "/terms"],
        disallow: ["/dashboard", "/dashboard/", "/admin", "/admin/", "/api/", "/auth/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
