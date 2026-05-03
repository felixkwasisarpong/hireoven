import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  calculateGhostJobRisk,
  probeApplyUrl,
  type ApplyUrlStatus,
} from "@/lib/jobs/ghost-job-risk"
import { detectHiringFreeze } from "@/lib/jobs/signals/hiring-freeze-detector"
import type { IntelligenceRiskLevel } from "@/types"

export const runtime = "nodejs"

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export type GhostRiskSignal = {
  name: string
  value: string
  weight: number
  status: "red" | "amber" | "green" | "gray"
  detail: string
}

export type GhostRiskApiResponse = {
  riskScore: number | null
  riskLevel: IntelligenceRiskLevel
  signals: GhostRiskSignal[]
  repostCount: number | null
  urlStatus: "live" | "redirects" | "dead" | "unknown"
  hasHiringFreeze: boolean
  lastScannedAt: string
  jobTitle: string
  companyName: string
}

// ── Signal builder ────────────────────────────────────────────────────────────

function signalStatus(impact: "positive" | "negative" | "neutral"): "green" | "red" | "gray" {
  if (impact === "positive") return "green"
  if (impact === "negative") return "red"
  return "gray"
}

function buildSignals(args: {
  freshnessDays: number | null
  verifiedDays: number | null
  urlStatus: ApplyUrlStatus
  repostCount: number | null
  hasSalary: boolean
  hasHiringFreeze: boolean
  freezeConfidence?: "confirmed" | "likely" | "possible" | null
  freezeHeadline?: string | null
  descriptionVaguenessScore: number
  isDirectCompanyLink: boolean
  isKnownAtsLink: boolean
}): GhostRiskSignal[] {
  const out: GhostRiskSignal[] = []

  // Posting age
  if (args.freshnessDays !== null) {
    const d = args.freshnessDays
    out.push({
      name: "Posting age",
      value: d === 0 ? "Today" : `${d} days old`,
      weight: d <= 14 ? -12 : d <= 45 ? 4 : d <= 90 ? 16 : 28,
      status: d <= 14 ? "green" : d <= 45 ? "amber" : "red",
      detail: d <= 14
        ? "Detected within the last 2 weeks — a strong freshness signal."
        : d <= 45
        ? "Moderately fresh posting."
        : d <= 90
        ? "Over 45 days old. Common for ghost jobs that were never filled."
        : `Very old — ${d} days since first detected. High ghost job correlation.`,
    })
  }

  // Apply URL
  const urlWeight: Record<ApplyUrlStatus, number> = { ok: -12, redirect: 4, dead: 35, unknown: 0 }
  const urlStatusDisplay: Record<ApplyUrlStatus, string> = {
    ok: "Reachable",
    redirect: "Redirects",
    dead: "Dead (404/410)",
    unknown: "Unchecked",
  }
  out.push({
    name: "Apply URL",
    value: urlStatusDisplay[args.urlStatus],
    weight: urlWeight[args.urlStatus],
    status: args.urlStatus === "ok" ? "green" : args.urlStatus === "dead" ? "red" : args.urlStatus === "redirect" ? "amber" : "gray",
    detail: args.urlStatus === "ok"
      ? "The apply link is live and reachable."
      : args.urlStatus === "dead"
      ? "The apply link returns a 404 or 410 — the role may be closed."
      : args.urlStatus === "redirect"
      ? "The apply link redirects. Verify it still lands on the correct role."
      : "Apply URL was not probed in this scan cycle.",
  })

  // Repost count
  if (args.repostCount !== null) {
    const r = args.repostCount
    const isHigh = r >= 5
    const isMed = r >= 3
    out.push({
      name: "Repost count",
      value: r === 0 ? "Not reposted" : `${r} reposts in 60d`,
      weight: isHigh ? 18 : isMed ? 10 : 0,
      status: isHigh ? "red" : isMed ? "amber" : "green",
      detail: r === 0
        ? "No duplicate postings detected for this company + title in the last 90 days."
        : r < 3
        ? "Reposted a small number of times — not yet a strong ghost signal."
        : `Reposted ${r} times recently. Repeated postings are a strong ghost job indicator.`,
    })
  }

  // Hiring freeze
  const freezeWeight =
    args.freezeConfidence === "confirmed" ? 20 :
    args.freezeConfidence === "likely" ? 16 : 10
  const freezeValue =
    args.freezeConfidence === "confirmed" ? "WARN Act verified" :
    args.freezeConfidence === "likely" ? "Likely (layoffs.fyi)" :
    args.hasHiringFreeze ? "Possible" : "None detected"
  out.push({
    name: "Hiring freeze",
    value: freezeValue,
    weight: args.hasHiringFreeze ? freezeWeight : 0,
    status: args.hasHiringFreeze ? "red" : "green",
    detail: args.hasHiringFreeze
      ? (args.freezeHeadline ?? "A hiring freeze or significant layoff has been reported for this employer. Open roles may not be actively filling.")
      : "No confirmed hiring freeze signal for this employer.",
  })

  // Salary
  out.push({
    name: "Salary listed",
    value: args.hasSalary ? "Yes" : "No",
    weight: args.hasSalary ? 0 : 3,
    status: args.hasSalary ? "green" : "amber",
    detail: args.hasSalary
      ? "Salary range is disclosed — a minor positive signal."
      : "No salary listed. Alone this is a weak signal, but it adds to overall opacity.",
  })

  // Description quality
  const dv = args.descriptionVaguenessScore
  out.push({
    name: "Description quality",
    value: dv === 0 ? "Good" : dv <= 5 ? "Vague language" : "Poor or missing",
    weight: dv,
    status: dv === 0 ? "green" : dv <= 5 ? "amber" : "red",
    detail: dv === 0
      ? "Description is substantive and doesn't rely on vague buzzwords."
      : dv <= 5
      ? "Description uses some vague hiring phrases ('rockstar', 'ninja', etc.)."
      : "Description is missing, very short, or relies heavily on generic filler text.",
  })

  // Source credibility
  if (args.isDirectCompanyLink) {
    out.push({
      name: "Link source",
      value: "Company domain",
      weight: -10,
      status: "green",
      detail: "Apply link points directly to the employer's own domain — a strong legitimacy signal.",
    })
  } else if (args.isKnownAtsLink) {
    out.push({
      name: "Link source",
      value: "Known ATS",
      weight: -8,
      status: "green",
      detail: "Apply link points to a well-known ATS (Greenhouse, Lever, Workday, etc.).",
    })
  }

  return out
}

// ── Repost count query ─────────────────────────────────────────────────────────

async function queryRepostCount(pool: ReturnType<typeof getPostgresPool>, args: {
  companyId: string
  jobId: string
  title: string
}): Promise<number> {
  try {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM jobs
       WHERE company_id = $1
         AND id <> $2
         AND is_active = true
         AND first_detected_at > NOW() - INTERVAL '90 days'
         AND (
           normalized_title ILIKE $3
           OR similarity(title, $4) > 0.55
         )`,
      [args.companyId, args.jobId, `%${args.title.split(/\s+/).slice(0, 4).join("%")}%`, args.title]
    )
    return Number(rows[0]?.cnt ?? 0)
  } catch {
    // pg_trgm may not be installed — fall back to ILIKE-only
    try {
      const { rows } = await pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM jobs
         WHERE company_id = $1
           AND id <> $2
           AND is_active = true
           AND first_detected_at > NOW() - INTERVAL '90 days'
           AND normalized_title ILIKE $3`,
        [args.companyId, args.jobId, `%${args.title.split(/\s+/).slice(0, 4).join("%")}%`]
      )
      return Number(rows[0]?.cnt ?? 0)
    } catch {
      return 0
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function urlStatusToDb(s: ApplyUrlStatus): "live" | "redirects" | "dead" | "unknown" {
  if (s === "ok") return "live"
  if (s === "redirect") return "redirects"
  if (s === "dead") return "dead"
  return "unknown"
}

function dbUrlStatusToApply(s: string | null): ApplyUrlStatus {
  if (s === "live") return "ok"
  if (s === "redirects") return "redirect"
  if (s === "dead") return "dead"
  return "unknown"
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  // ── 1. Check cache ──────────────────────────────────────────────────────
  type CachedRow = {
    risk_score: number | null
    risk_level: string
    signals: GhostRiskSignal[]
    repost_count: number | null
    url_status: string | null
    has_hiring_freeze: boolean
    last_scanned_at: string
  }
  const cached = await pool.query<CachedRow>(
    `SELECT risk_score, risk_level, signals, repost_count, url_status, has_hiring_freeze, last_scanned_at
     FROM ghost_job_scores
     WHERE job_id = $1`,
    [id]
  ).catch(() => ({ rows: [] as CachedRow[] }))

  const cachedRow = cached.rows[0]
  if (cachedRow && Date.now() - new Date(cachedRow.last_scanned_at).getTime() < CACHE_TTL_MS) {
    // Fetch job meta for title / company name even on cache hit
    const jobMeta = await pool.query<{ title: string; company_name: string | null }>(
      `SELECT j.title, c.name AS company_name FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
      [id]
    ).catch(() => ({ rows: [] as { title: string; company_name: string | null }[] }))
    const meta = jobMeta.rows[0]
    return NextResponse.json({
      riskScore: cachedRow.risk_score,
      riskLevel: cachedRow.risk_level as IntelligenceRiskLevel,
      signals: cachedRow.signals,
      repostCount: cachedRow.repost_count,
      urlStatus: (cachedRow.url_status ?? "unknown") as GhostRiskApiResponse["urlStatus"],
      hasHiringFreeze: cachedRow.has_hiring_freeze,
      lastScannedAt: cachedRow.last_scanned_at,
      jobTitle: meta?.title ?? "",
      companyName: meta?.company_name ?? "",
    } satisfies GhostRiskApiResponse)
  }

  // ── 2. Fetch job row ────────────────────────────────────────────────────
  const jobResult = await pool.query<{
    id: string
    title: string
    normalized_title: string | null
    company_id: string | null
    company_name: string | null
    ats_type: string | null
    domain: string | null
    apply_url: string | null
    salary_min: number | null
    salary_max: number | null
    description: string | null
    is_remote: boolean | null
    sponsors_h1b: boolean | null
    first_detected_at: string | null
    last_seen_at: string | null
    raw_data: Record<string, unknown> | null
  }>(
    `SELECT j.id, j.title, j.normalized_title, j.company_id,
            c.name AS company_name, c.ats_type, c.domain,
            j.apply_url, j.salary_min, j.salary_max,
            j.description, j.is_remote, j.sponsors_h1b,
            j.first_detected_at, j.last_seen_at, j.raw_data
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1
     LIMIT 1`,
    [id]
  )
  const job = jobResult.rows[0]
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const now = new Date()

  // ── 3. Run signals in parallel ──────────────────────────────────────────
  const [urlStatus, freeze, repostCount] = await Promise.all([
    probeApplyUrl(job.apply_url),
    detectHiringFreeze({ companyId: job.company_id, companyName: job.company_name }),
    job.company_id && job.normalized_title
      ? queryRepostCount(pool, { companyId: job.company_id, jobId: job.id, title: job.normalized_title })
      : Promise.resolve(0),
  ])

  // ── 4. Score ────────────────────────────────────────────────────────────
  const rawData = job.raw_data as Record<string, unknown> | null
  const postedAt = rawData?.posted_at_normalized as string | null ?? job.first_detected_at
  const lastVerifiedAt = job.last_seen_at

  const result = calculateGhostJobRisk({
    postedAt,
    lastVerifiedAt,
    applyUrlStatus: urlStatus,
    repostCount,
    description: job.description,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    atsType: job.ats_type,
    applyUrl: job.apply_url,
    companyDomain: job.domain,
    isRemote: job.is_remote,
    hasHiringFreeze: freeze.hasHiringFreeze,
    freezeConfidence: freeze.confidence ?? undefined,
    now,
  })

  // ── 5. Build detailed signals ───────────────────────────────────────────
  const quality = descriptionVaguenessScore(job.description)
  const isDirectCompany = isDirectCompanyLink(job.apply_url, job.domain)
  const isKnownAts = isKnownAtsLink(job.apply_url, job.ats_type)
  const freshnessDays = job.first_detected_at
    ? Math.floor((now.getTime() - new Date(job.first_detected_at).getTime()) / 86_400_000)
    : null
  const verifiedDays = job.last_seen_at
    ? Math.floor((now.getTime() - new Date(job.last_seen_at).getTime()) / 86_400_000)
    : null

  const signals = buildSignals({
    freshnessDays,
    verifiedDays,
    urlStatus,
    repostCount,
    hasSalary: job.salary_min != null || job.salary_max != null,
    hasHiringFreeze: freeze.hasHiringFreeze,
    freezeConfidence: freeze.confidence ?? undefined,
    freezeHeadline: freeze.headline ?? undefined,
    descriptionVaguenessScore: quality,
    isDirectCompanyLink: isDirectCompany,
    isKnownAtsLink: isKnownAts,
  })

  // ── 6. Persist to cache ─────────────────────────────────────────────────
  const dbUrlStatus = urlStatusToDb(urlStatus)
  const scannedAt = now.toISOString()
  pool.query(
    `INSERT INTO ghost_job_scores
       (job_id, risk_score, risk_level, signals, repost_count, url_status,
        has_hiring_freeze, has_salary, description_vagueness_score, last_scanned_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (job_id) DO UPDATE SET
       risk_score = EXCLUDED.risk_score,
       risk_level = EXCLUDED.risk_level,
       signals = EXCLUDED.signals,
       repost_count = EXCLUDED.repost_count,
       url_status = EXCLUDED.url_status,
       has_hiring_freeze = EXCLUDED.has_hiring_freeze,
       has_salary = EXCLUDED.has_salary,
       description_vagueness_score = EXCLUDED.description_vagueness_score,
       last_scanned_at = EXCLUDED.last_scanned_at,
       updated_at = EXCLUDED.updated_at`,
    [
      job.id,
      result.riskScore,
      result.riskLevel,
      JSON.stringify(signals),
      repostCount,
      dbUrlStatus,
      freeze.hasHiringFreeze,
      job.salary_min != null || job.salary_max != null,
      quality,
      scannedAt,
    ]
  ).catch(() => { /* fire-and-forget */ })

  return NextResponse.json({
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    signals,
    repostCount,
    urlStatus: dbUrlStatus,
    hasHiringFreeze: freeze.hasHiringFreeze,
    lastScannedAt: scannedAt,
    jobTitle: job.title,
    companyName: job.company_name ?? "",
  } satisfies GhostRiskApiResponse)
}

// ── Inline helpers (avoid re-importing engine internals) ──────────────────────

function isDirectCompanyLink(applyUrl?: string | null, domain?: string | null): boolean {
  if (!applyUrl || !domain) return false
  try {
    const host = new URL(applyUrl).hostname.replace(/^www\./, "").toLowerCase()
    const d = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.toLowerCase()
    return Boolean(d && (host === d || host.endsWith(`.${d}`)))
  } catch { return false }
}

function isKnownAtsLink(applyUrl?: string | null, atsType?: string | null): boolean {
  if (!applyUrl) return false
  try {
    const host = new URL(applyUrl).hostname
    return /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|jobvite\.com/.test(host)
      || ["greenhouse","lever","ashby","workday","icims","jobvite"].includes(atsType?.toLowerCase() ?? "")
  } catch { return false }
}

function descriptionVaguenessScore(desc?: string | null): number {
  const text = desc?.replace(/\s+/g, " ").trim() ?? ""
  if (!text) return 10
  if (text.length < 280) return 8
  const vague = ["fast-paced","rockstar","ninja","wear many hats","self starter","competitive salary"]
  const count = vague.filter((t) => text.toLowerCase().includes(t)).length
  return count >= 2 ? 5 : 0
}
