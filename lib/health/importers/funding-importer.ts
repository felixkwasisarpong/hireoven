import { getPostgresPool } from "@/lib/postgres/server"

export type FundingResult = {
  roundType: string | null
  amountUsd: number | null
  announcedDate: string | null
  leadInvestor: string | null
  monthsSince: number | null
}

function monthsBetween(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44))
}

// ── Public fallback — parse press release or news page ────────────────────────

async function tryPublicFallback(companyName: string, domain: string | null): Promise<FundingResult | null> {
  if (!domain) return null
  try {
    const pressUrl = `https://${domain}/newsroom`
    const res = await fetch(pressUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HireOven/1.0)" },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // Look for funding mentions in the page text
    const roundMatch = html.match(/series\s+([a-h])\s+(?:funding|round)/i)
    const amountMatch = html.match(/\$(\d+(?:\.\d+)?)\s*(million|billion|m\b|b\b)/i)
    const dateMatch = html.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+20\d{2}/i)

    if (!roundMatch && !amountMatch) return null

    let amountUsd: number | null = null
    if (amountMatch) {
      const n = Number(amountMatch[1])
      const unit = amountMatch[2].toLowerCase()
      amountUsd = unit.startsWith("b") ? n * 1_000_000_000 : n * 1_000_000
    }

    const announcedDate = dateMatch ? new Date(dateMatch[0]).toISOString().slice(0, 10) : null

    return {
      roundType: roundMatch ? `series_${roundMatch[1].toLowerCase()}` : "unknown",
      amountUsd,
      announcedDate,
      leadInvestor: null,
      monthsSince: announcedDate ? monthsBetween(announcedDate) : null,
    }
  } catch { return null }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function importFundingData(companyId: string, companyName: string): Promise<FundingResult | null> {
  const pool = getPostgresPool()

  // Get domain for fallback
  const domainRes = await pool.query<{ domain: string | null }>(
    `SELECT domain FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] as { domain: string | null }[] }))
  const domain = domainRes.rows[0]?.domain ?? null

  const result = await tryPublicFallback(companyName, domain)
  if (!result?.announcedDate) return null

  // Persist to company_funding_data
  await pool.query(
    `INSERT INTO company_funding_data
       (company_id, round_type, amount_usd, announced_date, lead_investor)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, round_type, announced_date) DO UPDATE SET
       amount_usd   = EXCLUDED.amount_usd,
       lead_investor = EXCLUDED.lead_investor`,
    [companyId, result.roundType ?? "unknown", result.amountUsd, result.announcedDate, result.leadInvestor]
  ).catch(() => {})

  return result
}
