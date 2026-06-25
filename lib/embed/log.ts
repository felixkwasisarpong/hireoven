import { createHash } from "crypto"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

// Privacy-safe impression logging for embeds (Spec 07).
// We persist ONLY: widget type, an opaque subject id, the referer's registrable
// DOMAIN (never the full URL or query), and a truncated hash of the user-agent.
// No IP, no cookies, no raw UA, no fingerprint. Bot user-agents are dropped.

export type WidgetType = "personal" | "company" | "leaderboard"

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|preview|monitor|probe|curl|wget|python-requests|axios|node-fetch/i

// Extract the registrable host from a Referer header. Returns null for same-origin
// (no referer), opaque referrers, or anything unparseable.
export function refererDomain(referer: string | null | undefined): string | null {
  if (!referer) return null
  try {
    const host = new URL(referer).hostname.toLowerCase()
    if (!host || host === "localhost") return null
    return host.replace(/^www\./, "")
  } catch {
    return null
  }
}

function uaHash(ua: string | null | undefined): string | null {
  if (!ua) return null
  return createHash("sha256").update(ua).digest("hex").slice(0, 16)
}

export function isBot(ua: string | null | undefined): boolean {
  return !!ua && BOT_RE.test(ua)
}

// Fire-and-forget impression write. Next 14 has no waitUntil(); on the self-hosted
// standalone server a non-awaited promise completes after the response flushes, so
// callers invoke this WITHOUT await and never block rendering on it.
export function logEmbedImpression(input: {
  widgetType: WidgetType
  subjectId: string | null
  referer: string | null
  userAgent: string | null
  embedTokenId?: string | null
}): void {
  if (!hasPostgresEnv()) return
  if (isBot(input.userAgent)) return
  const domain = refererDomain(input.referer)
  void getPostgresPool()
    .query(
      `INSERT INTO embed_events (widget_type, subject_id, referer_domain, ua_hash, embed_token_id)
       VALUES ($1, $2, $3, $4, $5::uuid)`,
      [input.widgetType, input.subjectId, domain, uaHash(input.userAgent), input.embedTokenId ?? null]
    )
    .catch((e) => {
      const code = (e as { code?: string })?.code
      if (code === "42P01" || code === "42703") return
      console.error("[embed] impression log failed", e)
    })
}

// Aggregate view count for a subject over the trailing window (consumer dashboard).
// Reads the daily rollup MV, falling back to 0 if it is absent.
export async function getEmbedViews(
  widgetType: WidgetType,
  subjectId: string,
  days = 30
): Promise<{ views: number; distinctDomains: number }> {
  if (!hasPostgresEnv()) return { views: 0, distinctDomains: 0 }
  try {
    const { rows } = await getPostgresPool().query<{ views: string; distinct_domains: string }>(
      `SELECT COALESCE(SUM(views), 0)::bigint AS views,
              COALESCE(MAX(distinct_domains), 0)::bigint AS distinct_domains
         FROM embed_event_daily_mv
        WHERE widget_type = $1 AND subject_id = $2
          AND day >= (now() - ($3 || ' days')::interval)::date`,
      [widgetType, subjectId, String(days)]
    )
    const r = rows[0]
    return { views: Number(r?.views ?? 0), distinctDomains: Number(r?.distinct_domains ?? 0) }
  } catch {
    return { views: 0, distinctDomains: 0 }
  }
}
