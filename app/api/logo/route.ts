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
  const logoUrl = token
    ? `https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=64&format=png`
    : `https://logo.clearbit.com/${encodeURIComponent(domain)}`

  try {
    const upstream = await fetch(logoUrl, {
      headers: { "User-Agent": "Hireoven/1.0" },
      signal: AbortSignal.timeout(4000),
    })

    if (!upstream.ok) {
      return new NextResponse(null, { status: 404 })
    }

    const contentType = upstream.headers.get("content-type") ?? "image/png"
    const buffer = await upstream.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=86400`,
        "CDN-Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
