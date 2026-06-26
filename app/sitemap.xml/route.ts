import { buildSitemapIndexXml, getSitemapEntries, sitemapChunkCount, siteBaseUrl } from "@/lib/seo/sitemap-entries"

// Sitemap INDEX. We have >50k URLs (Google's per-sitemap limit), and Next 14.0.4's
// built-in sitemap support can't emit a <sitemapindex>, so we hand-roll it: list one
// child sitemap per chunk at an absolute URL.
//
// force-dynamic (not revalidate): the heavy DB load is already absorbed by the 15-min
// process cache in getSitemapEntries, and we must NOT let Next's route cache pin a
// degraded render (a DB cold start once cached a 1-chunk index that dropped ~25k URLs).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { entries, ok } = await getSitemapEntries()
  // Never emit a truncated index from a DB-failed build — tell crawlers to retry.
  if (!ok) return new Response("sitemap temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } })

  const body = buildSitemapIndexXml(siteBaseUrl(), sitemapChunkCount(entries.length), new Date().toISOString())
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
    },
  })
}
