import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Cache logos for 7 days — company logos rarely change and this proxy is called
// from email clients where each image is a cold fetch.
const CACHE_SECONDS = 60 * 60 * 24 * 7

function getLogoDevPublishableToken(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN,
    process.env.LOGO_DEV_TOKEN,
  ]
  for (const raw of candidates) {
    const token = (raw ?? "").trim()
    if (token.startsWith("pk_")) return token
  }
  return ""
}

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain")?.trim().toLowerCase()
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return new NextResponse(null, { status: 400 })
  }

  const token = getLogoDevPublishableToken()
  const d = encodeURIComponent(domain)
  // Try sources in order. logo.dev gives the nicest brand logo but rate-limits
  // (429) under load; Google's favicon service is reliable and never rate-limits
  // us. Previously ANY failure returned 404 → every email logo broke into a "?".
  const sources = [
    token ? `https://img.logo.dev/${d}?token=${token}&size=64&format=png` : null,
    `https://www.google.com/s2/favicons?sz=64&domain=${d}`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
  ].filter((s): s is string => Boolean(s))

  for (const url of sources) {
    try {
      const upstream = await fetch(url, {
        headers: { "User-Agent": "Hireoven/1.0" },
        signal: AbortSignal.timeout(4000),
      })
      if (!upstream.ok) continue
      const buffer = await upstream.arrayBuffer()
      if (buffer.byteLength < 64) continue // skip empty/placeholder 1x1 responses
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "image/png",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=86400`,
          "CDN-Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        },
      })
    } catch {
      // try next source
    }
  }
  return new NextResponse(null, { status: 404 })
}
