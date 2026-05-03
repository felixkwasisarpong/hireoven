/**
 * Glassdoor rating ingestion — multi-source, gracefully null-safe.
 *
 * Approach order:
 * 1. DuckDuckGo Instant Answer API (free, no key, returns structured ratings)
 * 2. DuckDuckGo HTML search — parse the Glassdoor snippet from results
 * 3. Direct Glassdoor page — blocked by most servers, last resort
 *
 * Never throws. Returns null values on any failure.
 */

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

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRating(text: string): number | null {
  const patterns = [
    // Structured patterns: "4.1 out of 5", "Rated 4.1", "4.1/5"
    /(?:rated?\s+)([\d.]+)\s*(?:out\s+of\s+5|\/\s*5|stars?)/i,
    // JSON schema: "ratingValue":"4.1" or "ratingValue":4.1
    /"ratingValue"\s*:\s*"?([\d.]+)"?/,
    /"overallRating"\s*:\s*"?([\d.]+)"?/,
    // Plain pattern: "4.1 ★" or "★ 4.1"
    /[★]\s*([\d.]+)|([\d.]+)\s*[★]/,
    // Generic: number between 1–5 near "rating" or "glassdoor"
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
      RelatedTopics?: Array<{ Text?: string; Result?: string }>
      Infobox?: { content?: Array<{ label: string; value: string }> }
      Answer?: string
    }

    // Try Infobox first (most structured)
    const infoboxRating = data.Infobox?.content?.find(
      c => /rating|score|glassdoor/i.test(c.label)
    )
    if (infoboxRating) {
      const n = extractRating(infoboxRating.value)
      if (n) return { ...NULL_RESULT, rating: n }
    }

    // Try AbstractText
    const combined = [
      data.AbstractText,
      data.Answer,
      ...(data.RelatedTopics?.map(t => t.Text ?? "") ?? []),
    ].filter(Boolean).join(" ")

    if (combined.toLowerCase().includes("glassdoor")) {
      const rating = extractRating(combined)
      if (rating) {
        return {
          ...NULL_RESULT,
          rating,
          totalReviews: extractReviewCount(combined),
        }
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
      headers: {
        "User-Agent": UA,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // Find Glassdoor-related snippets in search results
    const snippets: string[] = []
    const snippetRe = /glassdoor\.com[^"]*"[^>]*>[^<]*<\/a>\s*<[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]{0,500})/gi
    let m: RegExpExecArray | null
    const re = new RegExp(snippetRe.source, snippetRe.flags)
    while ((m = re.exec(html)) !== null) snippets.push(m[1])

    // Also search the whole page for Glassdoor rating patterns
    const glassdoorSection = html.match(/glassdoor[\s\S]{0,1000}/i)?.[0] ?? ""
    snippets.push(glassdoorSection)

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

// ── Source 3: Direct Glassdoor (blocked on most servers) ─────────────────────

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
  _companyId: string,
  companyName: string
): Promise<GlassdoorResult> {
  // Try each source in priority order — return first hit
  const result =
    await tryDdgInstant(companyName) ??
    await tryDdgHtml(companyName) ??
    await tryGlassdoorDirect(companyName) ??
    NULL_RESULT

  return result
}
