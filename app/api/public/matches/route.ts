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

/** Honest role-relevance heuristic (NOT a resume match) → 60–99. */
function roleMatchPct(
  title: string,
  normalizedTitle: string,
  sponsorshipScore: number | null,
  sponsorsH1b: boolean,
  tokens: string[],
): number {
  const hay = `${title ?? ""} ${normalizedTitle ?? ""}`.toLowerCase()
  const hits = tokens.filter((t) => hay.includes(t.toLowerCase())).length
  const rel = tokens.length ? hits / tokens.length : 0
  const spon = Math.min(1, (sponsorshipScore ?? (sponsorsH1b ? 85 : 60)) / 100)
  return Math.min(99, Math.round(60 + rel * 32 + spon * 8))
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
      const matchPct = roleMatchPct(
        r.title ?? "",
        r.normalized_title ?? "",
        r.sponsorship_score,
        Boolean(r.sponsors_h1b),
        tokens,
      )
      const sponsorScore = r.sponsorship_score ?? (r.sponsors_h1b ? 90 : 65)
      const freshMins = r.first_detected_at
        ? Math.floor((Date.now() - new Date(r.first_detected_at).getTime()) / 60_000)
        : 99_999
      // Blend: sponsor strength leads, role relevance, then freshness.
      const blend = sponsorScore * 1.2 + matchPct * 1.0 + Math.max(0, 500 - freshMins) * 0.1
      return { r, matchPct, sponsorScore, blend }
    })

    const ranked = enriched
      .sort((a, b) => b.blend - a.blend)
      .slice(0, TEASER_COUNT)
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
