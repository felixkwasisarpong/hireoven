import { getPostgresPool } from "@/lib/postgres/server"

export type HeadcountResult = {
  currentEstimate: number | null
  changePct: number | null
  trend: "growing" | "stable" | "shrinking" | "contracting"
  source: "linkedin" | "job_velocity" | "unavailable"
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"

// ── LinkedIn public page scrape ────────────────────────────────────────────────

async function tryLinkedIn(linkedinUrl: string | null): Promise<number | null> {
  if (!linkedinUrl) return null
  try {
    const res = await fetch(linkedinUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const html = await res.text()
    // Patterns LinkedIn uses on public org pages
    const patterns = [
      /"employeeCount"\s*:\s*(\d+)/,
      /([\d,]+)\s*employees?\s+on\s+LinkedIn/i,
      /([\d,]+)\s*employees?/i,
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m) {
        const n = Number(m[1].replace(/,/g, ""))
        if (n > 0) return n
      }
    }
    return null
  } catch { return null }
}

// ── Job posting velocity proxy ─────────────────────────────────────────────────

async function jobVelocityProxy(companyId: string): Promise<HeadcountResult> {
  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<{
      recent_90d: string
      prior_90d: string
      active_now: string
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE first_detected_at > NOW() - INTERVAL '90 days')::text AS recent_90d,
         COUNT(*) FILTER (
           WHERE first_detected_at > NOW() - INTERVAL '180 days'
             AND first_detected_at <= NOW() - INTERVAL '90 days'
         )::text AS prior_90d,
         COUNT(*) FILTER (WHERE is_active = true)::text AS active_now
       FROM jobs
       WHERE company_id = $1`,
      [companyId]
    )
    const r = rows[0]
    if (!r) return { currentEstimate: null, changePct: null, trend: "stable", source: "unavailable" }

    const recent = Number(r.recent_90d)
    const prior = Number(r.prior_90d)
    const active = Number(r.active_now)

    // Need at least some posting history to draw conclusions
    if (recent + prior < 3) {
      return { currentEstimate: active > 0 ? active : null, changePct: null, trend: "stable", source: "job_velocity" }
    }

    const ratio = prior > 0 ? recent / prior : recent > 0 ? 2 : 1
    const changePct = Math.round((ratio - 1) * 100)

    let trend: HeadcountResult["trend"] = "stable"
    if (changePct >= 10) trend = "growing"
    else if (changePct >= 1) trend = "growing"
    else if (changePct >= -1) trend = "stable"
    else if (changePct >= -10) trend = "shrinking"
    else if (changePct >= -20) trend = "shrinking"
    else trend = "contracting"

    return { currentEstimate: active > 0 ? active : null, changePct, trend, source: "job_velocity" }
  } catch {
    return { currentEstimate: null, changePct: null, trend: "stable", source: "unavailable" }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function importLinkedinHeadcount(companyId: string): Promise<HeadcountResult> {
  const pool = getPostgresPool()

  // Try to find LinkedIn URL from companies table
  const companyRes = await pool.query<{ linkedin_url: string | null }>(
    `SELECT linkedin_url FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] as { linkedin_url: string | null }[] }))

  const linkedinUrl = companyRes.rows[0]?.linkedin_url ?? null
  const linkedinCount = await tryLinkedIn(linkedinUrl)

  // Always augment with job velocity regardless of LinkedIn availability
  const velocity = await jobVelocityProxy(companyId)

  if (linkedinCount !== null) {
    return {
      currentEstimate: linkedinCount,
      changePct: velocity.changePct,
      trend: velocity.trend,
      source: "linkedin",
    }
  }

  return velocity
}
