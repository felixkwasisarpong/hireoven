import { buildSitemapIndexXml, getSitemapEntries, sitemapChunkCount, siteBaseUrl } from "@/lib/seo/sitemap-entries"

// Sitemap INDEX. We have >50k URLs (Google's per-sitemap limit), and Next 14.0.4's
// built-in sitemap support can't emit a <sitemapindex>, so we hand-roll it: list one
// child sitemap per chunk at an absolute URL. Re-rendered at most every 15 min.
export const runtime = "nodejs"
export const revalidate = 900

export async function GET() {
  const entries = await getSitemapEntries()
  const body = buildSitemapIndexXml(siteBaseUrl(), sitemapChunkCount(entries.length), new Date().toISOString())
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
    },
  })
}
