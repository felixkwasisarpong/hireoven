import { getPostgresPool } from "@/lib/postgres/server"
import type { FreezeConfidence } from "@/lib/layoffs/summary-computer"

export type HiringFreezeResult = {
  hasHiringFreeze: boolean
  confidence: FreezeConfidence | null
  detectedAt: Date | null
  headline: string | null
  employeesAffected: number | null
  source: "warn_act" | "layoffs_fyi" | "news_signal" | "static_list" | null
}

/**
 * Detects if a company has an active hiring freeze.
 *
 * Priority:
 * 1. company_layoff_summary (computed from layoffs.fyi + WARN Act imports)
 * 2. company_news_signals (ad-hoc signals from crawler)
 * 3. Static hardcoded list (last-resort fallback)
 *
 * Never throws — returns hasHiringFreeze: false on any DB error.
 */
export async function detectHiringFreeze(args: {
  companyId: string | null | undefined
  companyName: string | null | undefined
}): Promise<HiringFreezeResult> {
  const { companyId, companyName } = args

  if (companyId) {
    try {
      const pool = getPostgresPool()

      // ── 1. company_layoff_summary (richest source) ────────────────────────
      const summaryRes = await pool.query<{
        has_active_freeze: boolean
        freeze_confidence: FreezeConfidence | null
        most_recent_layoff_date: string | null
        total_employees_affected: number | null
        layoff_trend: string | null
      }>(
        `SELECT has_active_freeze, freeze_confidence, most_recent_layoff_date,
                total_employees_affected, layoff_trend
         FROM company_layoff_summary
         WHERE company_id = $1
         LIMIT 1`,
        [companyId]
      )

      if (summaryRes.rows.length > 0) {
        const s = summaryRes.rows[0]
        if (s.has_active_freeze) {
          // Get the most recent event for detail
          const eventRes = await pool.query<{
            source: string
            headline: string | null
            event_date: string
          }>(
            `SELECT source, headline, event_date::text
             FROM layoff_events
             WHERE company_id = $1
               AND event_date >= NOW() - INTERVAL '90 days'
             ORDER BY event_date DESC
             LIMIT 1`,
            [companyId]
          )
          const event = eventRes.rows[0]
          return {
            hasHiringFreeze: true,
            confidence: s.freeze_confidence,
            detectedAt: s.most_recent_layoff_date ? new Date(s.most_recent_layoff_date) : null,
            headline: event?.headline ?? buildHeadline(s.freeze_confidence, s.total_employees_affected),
            employeesAffected: s.total_employees_affected,
            source: (event?.source ?? "layoffs_fyi") as HiringFreezeResult["source"],
          }
        }
        // Summary exists but no active freeze
        return { hasHiringFreeze: false, confidence: null, detectedAt: null, headline: null, employeesAffected: null, source: null }
      }

      // ── 2. company_news_signals (fallback) ────────────────────────────────
      const newsRes = await pool.query<{ detected_at: string; headline: string | null }>(
        `SELECT detected_at, headline
         FROM company_news_signals
         WHERE company_id = $1
           AND signal_type = 'hiring_freeze'
           AND detected_at > NOW() - INTERVAL '180 days'
         ORDER BY detected_at DESC
         LIMIT 1`,
        [companyId]
      )
      if (newsRes.rows.length > 0) {
        return {
          hasHiringFreeze: true,
          confidence: "possible",
          detectedAt: new Date(newsRes.rows[0].detected_at),
          headline: newsRes.rows[0].headline,
          employeesAffected: null,
          source: "news_signal",
        }
      }
    } catch { /* Non-critical — fall through */ }
  }

  // ── 3. Static known-freeze list (last resort until live data covers it) ──
  if (companyName && KNOWN_FREEZE_COMPANIES.has(normalizeCompanyName(companyName))) {
    return {
      hasHiringFreeze: true,
      confidence: "possible",
      detectedAt: null,
      headline: "Hiring slowdown reported via public sources (layoffs.fyi)",
      employeesAffected: null,
      source: "static_list",
    }
  }

  return { hasHiringFreeze: false, confidence: null, detectedAt: null, headline: null, employeesAffected: null, source: null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildHeadline(confidence: FreezeConfidence | null, employees: number | null): string {
  if (confidence === "confirmed") {
    return employees
      ? `WARN Act filing — ${employees.toLocaleString()} employees affected`
      : "WARN Act notice filed — confirmed layoff event"
  }
  if (confidence === "likely") {
    return employees
      ? `Layoff reported — ${employees.toLocaleString()} employees affected (layoffs.fyi)`
      : "Significant layoff reported via layoffs.fyi"
  }
  return "Possible hiring slowdown reported via public sources"
}

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/\b(inc\.?|corp\.?|corporation|ltd\.?|llc\.?)\b/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
}

const KNOWN_FREEZE_COMPANIES = new Set([
  "google","alphabet","meta","facebook","amazon","aws","microsoft","salesforce",
  "twitter","x corp","x","lyft","stripe","shopify","snap","snapchat","spotify",
  "coinbase","robinhood","peloton","opendoor","redfin","zillow","better",
  "carvana","docusign","paypal","ebay","intel","ibm","oracle","cisco","dell",
  "hp","hewlett packard",
])
