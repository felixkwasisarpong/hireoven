/**
 * Glassdoor rating ingestion — reads extension-scraped data first.
 *
 * Priority order:
 * 1. scout_enrichment JSONB on companies (populated by Chrome extension browsing Glassdoor)
 * 2. DuckDuckGo Instant Answer API (free, no key)
 * 3. DuckDuckGo HTML search
 * 4. Direct Glassdoor page (usually blocked server-side)
 *
 * Extension data is considered fresh for 7 days. Server-side scraping is a
 * last resort — Glassdoor aggressively blocks server requests.
 *
 * Never throws. Returns null values on any failure.
 */

import { getPostgresPool } from "@/lib/postgres/server"

export type GlassdoorResult = {
  rating: number | null
  rating12moAgo: number | null
  totalReviews: number | null
  recommendPct: number | null
  ceoApprovalPct: number | null
  blocked: boolean
}

const NULL_RESULT: GlassdoorResult = {
  rating: null, rating12moAgo: null, totalReviews: null,
  recommendPct: null, ceoApprovalPct: null, blocked: false,
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"

// ── Source 0: Extension scout_enrichment (most reliable) ─────────────────────

async function tryApexEnrichment(companyId: string): Promise<GlassdoorResult | null> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ gd: Record<string, unknown> | null }>(
      `SELECT scout_enrichment->'glassdoor' AS gd FROM companies WHERE id = $1 LIMIT 1`,
      [companyId]
    )
    const gd = rows[0]?.gd
    if (!gd || typeof gd !== "object") return null

    const rating = typeof gd.rating === "number" ? gd.rating : null
    if (!rating || rating < 1 || rating > 5) return null

    const enrichedAt = typeof gd.lastEnrichedAt === "string" ? gd.lastEnrichedAt : null
    const stale = !enrichedAt || Date.now() - new Date(enrichedAt).getTime() > STALE_MS
    if (stale) return null

    return {
      rating,
      rating12moAgo: null,
      totalReviews: typeof gd.reviewCount === "number" ? gd.reviewCount : null,
      recommendPct: typeof gd.recommendToFriend === "number" ? gd.recommendToFriend : null,
      ceoApprovalPct: typeof gd.ceoApproval === "number" ? gd.ceoApproval : null,
      blocked: false,
    }
  } catch { return null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRating(text: string): number | null {
  const patterns = [
    /(?:rated?\s+)([\d.]+)\s*(?:out\s+of\s+5|\/\s*5|stars?)/i,
    /"ratingValue"\s*:\s*"?([\d.]+)"?/,
    /"overallRating"\s*:\s*"?([\d.]+)"?/,
    /[★]\s*([\d.]+)|([\d.]+)\s*[★]/,
    /(?:glassdoor|rating|score)[^\d]*([\d]\.[0-9])/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    const raw = m?.[1] ?? m?.[2]
    if (raw) {
      const n = Number(raw)
      if (n >= 1 && n <= 5) return Math.round(n * 10) / 10
    }
  }
  return null
}

function extractReviewCount(text: string): number | null {
  const m = text.match(/([\d,]+)\s*reviews?/i)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

// ── Source 1: DuckDuckGo Instant Answer API ───────────────────────────────────

async function tryDdgInstant(companyName: string): Promise<GlassdoorResult | null> {
  try {
    const q = encodeURIComponent(`${companyName} glassdoor rating`)
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      AbstractText?: string
      RelatedTopics?: Array<{ Text?: string }>
      Infobox?: { content?: Array<{ label: string; value: string }> }
      Answer?: string
    }

    const infoboxRating = data.Infobox?.content?.find(
      c => /rating|score|glassdoor/i.test(c.label)
    )
    if (infoboxRating) {
      const n = extractRating(infoboxRating.value)
      if (n) return { ...NULL_RESULT, rating: n }
    }

    const combined = [
      data.AbstractText,
      data.Answer,
      ...(data.RelatedTopics?.map(t => t.Text ?? "") ?? []),
    ].filter(Boolean).join(" ")

    if (combined.toLowerCase().includes("glassdoor")) {
      const rating = extractRating(combined)
      if (rating) {
        return { ...NULL_RESULT, rating, totalReviews: extractReviewCount(combined) }
      }
    }
    return null
  } catch { return null }
}

// ── Source 2: DuckDuckGo HTML search ─────────────────────────────────────────

async function tryDdgHtml(companyName: string): Promise<GlassdoorResult | null> {
  try {
    const q = encodeURIComponent(`${companyName} glassdoor reviews rating`)
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const html = await res.text()

    const snippets: string[] = []
    const re = /glassdoor\.com[^"]*"[^>]*>[^<]*<\/a>\s*<[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]{0,500})/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) snippets.push(m[1])
    snippets.push(html.match(/glassdoor[\s\S]{0,1000}/i)?.[0] ?? "")

    for (const snippet of snippets) {
      const rating = extractRating(snippet)
      if (rating) {
        return {
          ...NULL_RESULT,
          rating,
          totalReviews: extractReviewCount(snippet),
          recommendPct: (() => {
            const pm = snippet.match(/(\d+)%\s*(?:would\s+)?recommend/i)
            return pm ? Number(pm[1]) : null
          })(),
        }
      }
    }
    return null
  } catch { return null }
}

// ── Source 3: Direct Glassdoor (usually blocked server-side) ──────────────────

async function tryGlassdoorDirect(companyName: string): Promise<GlassdoorResult | null> {
  try {
    const q = encodeURIComponent(companyName)
    const res = await fetch(
      `https://www.glassdoor.com/Search/results.htm?keyword=${q}`,
      {
        headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(8_000),
      }
    )
    if (res.status === 403 || res.status === 429) return null
    if (!res.ok) return null
    const html = await res.text()
    const rating = extractRating(html)
    if (!rating) return null
    return {
      ...NULL_RESULT,
      rating,
      totalReviews: extractReviewCount(html),
      recommendPct: (() => {
        const pm = html.match(/(\d+)%\s*(?:would\s+)?recommend/i)
        return pm ? Number(pm[1]) : null
      })(),
    }
  } catch { return null }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function importGlassdoorData(
  companyId: string,
  companyName: string
): Promise<GlassdoorResult> {
  return (
    await tryApexEnrichment(companyId) ??
    await tryDdgInstant(companyName) ??
    await tryDdgHtml(companyName) ??
    await tryGlassdoorDirect(companyName) ??
    NULL_RESULT
  )
}
