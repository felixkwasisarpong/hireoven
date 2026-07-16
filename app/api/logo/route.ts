import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Cache logos for 7 days — company logos rarely change and this proxy is called
// from email clients where each image is a cold fetch.
const CACHE_SECONDS = 60 * 60 * 24 * 7

// Synthetic identifiers we mint during discovery (adzuna-*.placeholder,
// *.jazzhr-tenant, wellington:wd5:external.workday-tenant, …). No favicon
// service can resolve these — don't burn 3 upstream timeouts finding that out.
const SYNTHETIC_DOMAIN_RE = /placeholder|discovered|-employer|-tenant|\.apex(\b|$)|:/i

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

/**
 * Last-resort avatar: the domain's first letter on the brand-orange gradient,
 * rendered to PNG (Gmail's image proxy won't display SVG). Served with the
 * same long cache as a real logo.
 *
 * This is why the route must NEVER 404: sent emails embed /api/logo URLs
 * forever, so a non-image response here is a permanent broken-image icon in
 * every inbox that ever received that company.
 */
async function letterAvatarPng(seed: string): Promise<Buffer> {
  const letter = (seed.match(/[a-z0-9]/i)?.[0] ?? "•").toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF5C18"/>
        <stop offset="1" stop-color="#FF9A3C"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="24" fill="url(#g)"/>
    <text x="64" y="86" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-size="64" font-weight="800" fill="#ffffff">${letter}</text>
  </svg>`
  const { default: sharp } = await import("sharp")
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function imageResponse(body: Buffer | ArrayBuffer, contentType: string): NextResponse {
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=86400`,
      "CDN-Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    },
  })
}

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain")?.trim().toLowerCase() ?? ""
  if (!domain) {
    // No seed at all — still return an image, not an error.
    return imageResponse(await letterAvatarPng("•"), "image/png")
  }

  const looksReal = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !SYNTHETIC_DOMAIN_RE.test(domain)

  if (looksReal) {
    const token = getLogoDevPublishableToken()
    const d = encodeURIComponent(domain)
    // Try sources in order. logo.dev gives the nicest brand logo but rate-limits
    // (429) under load; Google's favicon service is reliable and never rate-limits
    // us.
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
        return imageResponse(buffer, upstream.headers.get("content-type") ?? "image/png")
      } catch {
        // try next source
      }
    }
  }

  return imageResponse(await letterAvatarPng(domain), "image/png")
}
