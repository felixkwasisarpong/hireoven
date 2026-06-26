import { buildUrlsetXml, getSitemapEntries, SITEMAP_CHUNK, sitemapChunkCount } from "@/lib/seo/sitemap-entries"

// Child sitemap for one chunk. Served at /sitemap/<n>.xml and referenced from the
// index at /sitemap.xml. Each chunk holds at most SITEMAP_CHUNK (<50k) URLs.
// force-dynamic for the same reason as the index route (see its comment).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const idx = Number.parseInt(params.id.replace(/\.xml$/, ""), 10)
  const { entries, ok } = await getSitemapEntries()
  if (!ok) return new Response("sitemap temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } })

  const chunks = sitemapChunkCount(entries.length)
  if (!Number.isInteger(idx) || idx < 0 || idx >= chunks) {
    return new Response("Not found", { status: 404 })
  }

  const body = buildUrlsetXml(entries.slice(idx * SITEMAP_CHUNK, (idx + 1) * SITEMAP_CHUNK))
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
    },
  })
}
