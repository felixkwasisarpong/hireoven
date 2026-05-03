import { getPostgresPool } from "@/lib/postgres/server"

export type MatchConfidence = "exact" | "high" | "medium" | "low" | "none"

export type MatchResult = {
  companyId: string | null
  confidence: MatchConfidence
  matched: boolean
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const STRIP_SUFFIXES =
  /\s*\b(incorporated|inc\.?|llc\.?|ltd\.?|corp\.?|corporation|platforms|technologies|technology|solutions|group|holdings|systems|services|international|global|worldwide|enterprises)\b\.*\s*/gi

export function normalizeCompanyName(raw: string): string {
  return raw
    .replace(STRIP_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

// ── Domain extraction from source URL ────────────────────────────────────────

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/^jobs\./, "")
      .replace(/^careers\./, "")
      .toLowerCase()
  } catch { return null }
}

// ── Match logic ───────────────────────────────────────────────────────────────

export async function matchCompany(args: {
  companyNameRaw: string
  sourceUrl?: string | null
  source: string
}): Promise<MatchResult> {
  const { companyNameRaw, sourceUrl, source } = args
  const pool = getPostgresPool()
  const normalized = normalizeCompanyName(companyNameRaw)
  if (!normalized) return { companyId: null, confidence: "none", matched: false }

  // 1. Exact match (case-insensitive)
  const exactRes = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE lower(name) = lower($1) LIMIT 1`,
    [companyNameRaw.trim()]
  ).catch(() => ({ rows: [] as { id: string }[] }))
  if (exactRes.rows[0]) {
    return { companyId: exactRes.rows[0].id, confidence: "exact", matched: true }
  }

  // 2. Exact match on normalised name
  const normExactRes = await pool.query<{ id: string }>(
    `SELECT id FROM companies
     WHERE lower(regexp_replace(name, $2, ' ', 'gi')) = $1
     LIMIT 1`,
    [normalized, STRIP_SUFFIXES.source]
  ).catch(() => ({ rows: [] as { id: string }[] }))
  if (normExactRes.rows[0]) {
    return { companyId: normExactRes.rows[0].id, confidence: "high", matched: true }
  }

  // 3. Domain match from source URL
  const domain = domainFromUrl(sourceUrl)
  if (domain) {
    const domainRes = await pool.query<{ id: string }>(
      `SELECT id FROM companies WHERE lower(domain) = $1 LIMIT 1`,
      [domain]
    ).catch(() => ({ rows: [] as { id: string }[] }))
    if (domainRes.rows[0]) {
      return { companyId: domainRes.rows[0].id, confidence: "high", matched: true }
    }
  }

  // 4. Trigram similarity (pg_trgm) — with ILIKE fallback
  const trigramRes = await pool.query<{ id: string; sim: number }>(
    `SELECT id, similarity(name, $1) AS sim
     FROM companies
     WHERE similarity(name, $1) > 0.6
     ORDER BY sim DESC
     LIMIT 1`,
    [companyNameRaw.trim()]
  ).catch(async () => {
    // Fallback if pg_trgm not available
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
      [`%${normalized}%`]
    ).catch(() => ({ rows: [] as { id: string }[] }))
    return { rows: r.rows.map(row => ({ id: row.id, sim: 0.65 })) }
  })

  if (trigramRes.rows[0]) {
    const sim = trigramRes.rows[0].sim
    const confidence: MatchConfidence = sim >= 0.85 ? "high" : sim >= 0.7 ? "medium" : "low"
    const companyId = trigramRes.rows[0].id

    // Log low-confidence matches for manual review
    if (confidence === "low" || confidence === "medium") {
      pool.query(
        `INSERT INTO layoff_match_review (company_name_raw, suggested_company_id, confidence, source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [companyNameRaw, companyId, confidence, source]
      ).catch(() => {})
    }

    return { companyId, confidence, matched: true }
  }

  // No match — log for review
  pool.query(
    `INSERT INTO layoff_match_review (company_name_raw, suggested_company_id, confidence, source)
     VALUES ($1, NULL, 'none', $2)
     ON CONFLICT DO NOTHING`,
    [companyNameRaw, source]
  ).catch(() => {})

  return { companyId: null, confidence: "none", matched: false }
}
