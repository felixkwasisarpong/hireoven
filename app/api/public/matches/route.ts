import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  buildJobSearchTokenSql,
  escapeLikePattern,
  tokenizeJobSearchQuery,
} from "@/lib/jobs/search-sql"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PUBLIC, UNAUTHENTICATED sponsor-checked matches — the "value before signup"
 * teaser for the /find ad landing page. Lives under /api/public/* so the
 * middleware auth gate (which protects /api/match/*) never touches it.
 *
 * It does NOT do resume-based scoring (there is no user/resume yet). It returns
 * a small, honest teaser: real sponsor-checked jobs for the typed role, ranked
 * by sponsorship strength + role relevance + freshness, capped at TEASER_COUNT.
 * The full personalized match feed stays gated behind signup.
 */

const TEASER_COUNT = 5
const CANDIDATE_POOL = 40
const MAX_ROLE_LEN = 80

// ── tiny in-memory cache for hot roles (best-effort; per serverless instance) ──
type CacheEntry = { at: number; payload: unknown }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 120_000
const CACHE_MAX = 200

// ── best-effort per-IP rate limit (per instance; add Upstash for hard limits) ──
const HITS = new Map<string, { count: number; resetAt: number }>()
const RL_WINDOW_MS = 60_000
const RL_MAX = 30

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const cur = HITS.get(ip)
  if (!cur || now > cur.resetAt) {
    HITS.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS })
    return false
  }
  cur.count += 1
  return cur.count > RL_MAX
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

function freshnessLabel(ts: string | Date | null | undefined): string {
  if (!ts) return ""
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function salaryLabel(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (!min && !max) return null
  const c = !currency || currency === "USD" ? "$" : `${currency} `
  const k = (n: number) => `${c}${Math.round(n / 1000)}k`
  if (min && max) return `${k(min)}–${k(max)}`
  return k((min || max) as number)
}

const titleWords = (s: string | null | undefined): string[] =>
  (s ?? "").toLowerCase().match(/[a-z0-9+#.]+/g) ?? []

/**
 * Honest title-fit heuristic (NOT a resume match). Discriminates by how well the
 * job title actually matches the typed role — every candidate already contains
 * the query tokens (the SQL requires it), so the signal is *specificity* (is the
 * title mostly the query, or is the query buried in a long title?) plus whether
 * the exact phrase appears. Ranges ~62–97 so results visibly vary instead of all
 * pinning to 99.
 */
function roleMatchPct(
  title: string,
  normalizedTitle: string,
  tokens: string[],
  rawRole: string,
): number {
  const words = new Set([...titleWords(title), ...titleWords(normalizedTitle)])
  const q = tokens.map((t) => t.toLowerCase())
  const matched = q.filter((t) => words.has(t)).length
  const coverage = q.length ? matched / q.length : 0
  const len = Math.max(titleWords(title).length, titleWords(normalizedTitle).length, 1)
  const specificity = Math.min(1, matched / len)
  const role = rawRole.trim().toLowerCase()
  const exact = role && `${title} ${normalizedTitle}`.toLowerCase().includes(role) ? 1 : 0
  // Weight specificity heavily so a tight title ("Software Engineer") clearly
  // out-scores the query buried in a long one ("Sr. Software Engineer II, Ads").
  const fit = 0.3 * coverage + 0.5 * specificity + 0.2 * exact // 0–1
  return Math.max(62, Math.min(97, Math.round(62 + fit * 35)))
}

type Row = {
  id: string
  title: string | null
  normalized_title: string | null
  location: string | null
  is_remote: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  apply_url: string | null
  posted_at: string | null
  first_detected_at: string | null
  company_name: string | null
  company_domain: string | null
  company_petitions: number | null
}

export async function POST(request: NextRequest) {
  try {
    if (!hasPostgresEnv()) return NextResponse.json({ matches: [] })

    if (rateLimited(clientIp(request))) {
      return NextResponse.json({ error: "rate_limited", matches: [] }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown
      location?: unknown
    }
    const role = typeof body.role === "string" ? body.role.trim().slice(0, MAX_ROLE_LEN) : ""
    const location =
      typeof body.location === "string" ? body.location.trim().slice(0, MAX_ROLE_LEN) : ""
    if (!role) return NextResponse.json({ matches: [] })

    const cacheKey = `${role.toLowerCase()}|${location.toLowerCase()}`
    const cached = CACHE.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
      })
    }

    const where: string[] = [
      "jobs.is_active = true",
      sqlPublishedJob("jobs"),
      sqlJobLocatedInUsa("jobs", { companyAlias: "companies" }),
      // Sponsor-checked policy mirrors the authed feed.
      `(
        jobs.sponsors_h1b = true
        OR (jobs.sponsorship_score > 60 AND jobs.apply_url NOT ILIKE '%dice.com%')
      )`,
    ]
    const params: Array<string | number> = []
    const addParam = (v: string | number) => {
      params.push(v)
      return `$${params.length}`
    }

    const tokens = tokenizeJobSearchQuery(role)
    for (const token of tokens) {
      const p = addParam(`%${escapeLikePattern(token)}%`)
      where.push(buildJobSearchTokenSql({ patternParam: p, token }))
    }
    if (location) {
      const p = addParam(`%${escapeLikePattern(location)}%`)
      where.push(`(jobs.location ILIKE ${p} ESCAPE '\\' OR jobs.is_remote = true)`)
    }

    const limitParam = addParam(CANDIDATE_POOL)
    const sql = `
      SELECT jobs.id, jobs.title, jobs.normalized_title, jobs.location, jobs.is_remote,
             jobs.salary_min, jobs.salary_max, jobs.salary_currency,
             jobs.sponsors_h1b, jobs.sponsorship_score, jobs.apply_url,
             jobs.posted_at, jobs.first_detected_at,
             companies.name AS company_name,
             companies.domain AS company_domain,
             companies.h1b_sponsor_count_3yr AS company_petitions
      FROM jobs
      LEFT JOIN companies ON companies.id = jobs.company_id
      WHERE ${where.join("\n        AND ")}
      ORDER BY jobs.first_detected_at DESC NULLS LAST
      LIMIT ${limitParam}
    `

    const { rows } = await getPostgresPool().query<Row>(sql, params)

    const enriched = rows.map((r) => {
      const matchPct = roleMatchPct(r.title ?? "", r.normalized_title ?? "", tokens, role)
      // Composite sponsor strength from REAL signals: DOL sponsorship confidence
      // nudged by actual recent petition volume (a heavier filer is a stronger
      // bet). Capped at 98 so it spreads and never pins to a flat, fake-looking
      // 100. Falls back modestly only when confidence is genuinely missing.
      const conf =
        typeof r.sponsorship_score === "number" && r.sponsorship_score > 0
          ? r.sponsorship_score
          : r.sponsors_h1b
            ? 72
            : 55
      const petitions = r.company_petitions ?? 0
      const petAdj = petitions > 0 ? Math.min(12, Math.round(Math.log10(petitions + 1) * 4)) : 0
      const sponsorScore = Math.max(40, Math.min(98, Math.round(conf * 0.88 + petAdj)))
      const freshMins = r.first_detected_at
        ? Math.floor((Date.now() - new Date(r.first_detected_at).getTime()) / 60_000)
        : 99_999
      // Relevance leads (so the shown match % and sponsor scores actually vary),
      // then sponsor strength, then freshness.
      const blend = matchPct * 1.5 + sponsorScore * 0.5 + Math.max(0, 500 - freshMins) * 0.1
      return { r, matchPct, sponsorScore, blend }
    })

    // Rank by blend, but drop near-duplicate titles + repeated companies so the
    // teaser reads as a varied, credible set instead of five identical rows.
    const sorted = enriched.sort((a, b) => b.blend - a.blend)
    const seenTitle = new Set<string>()
    const companyCount = new Map<string, number>()
    const picked: typeof sorted = []
    for (const e of sorted) {
      const titleKey = (e.r.title ?? "").trim().toLowerCase()
      const companyKey = (e.r.company_name ?? "").trim().toLowerCase()
      if (titleKey && seenTitle.has(titleKey)) continue
      if (companyKey && (companyCount.get(companyKey) ?? 0) >= 2) continue
      if (titleKey) seenTitle.add(titleKey)
      if (companyKey) companyCount.set(companyKey, (companyCount.get(companyKey) ?? 0) + 1)
      picked.push(e)
      if (picked.length >= TEASER_COUNT) break
    }
    const ranked = (picked.length ? picked : sorted.slice(0, TEASER_COUNT))
      .map(({ r, matchPct, sponsorScore }) => ({
        id: r.id,
        title: r.title ?? role,
        company: r.company_name ?? "Verified employer",
        companyDomain: r.company_domain ?? null,
        location: r.location ?? (r.is_remote ? "Remote (US)" : ""),
        salary: salaryLabel(r.salary_min, r.salary_max, r.salary_currency),
        sponsorScore,
        sponsorsH1b: Boolean(r.sponsors_h1b),
        petitions: r.company_petitions && r.company_petitions > 0 ? r.company_petitions : null,
        freshness: freshnessLabel(r.first_detected_at ?? r.posted_at),
        matchPct,
      }))

    const payload = { role, matches: ranked, total: rows.length }

    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string)
    CACHE.set(cacheKey, { at: Date.now(), payload })

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    })
  } catch (error) {
    console.error("[public/matches] failed:", error)
    return NextResponse.json({ matches: [] }, { status: 200 })
  }
}
