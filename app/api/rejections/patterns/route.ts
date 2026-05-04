import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { normalizeTitle } from "@/lib/rejections/pattern-computer"

export const runtime = "nodejs"

const MIN_SUBMISSIONS = 10

type FunnelStage = { stage: string; label: string; count: number; rate: number }

type ProfileSignal = {
  signal: string
  youHaveIt: boolean
  percentWhoGotInHadIt: number
  status: "pass" | "fail" | "warn"
  icon: string
}

type Insight = {
  title: string
  detail: string
  stat: string
  severity: "positive" | "warning" | "negative"
  icon: string
}

export type PatternsResponse =
  | { insufficientData: true; totalSubmissions: number; companyName: string; jobTitle: string }
  | {
      insufficientData: false
      companyName: string
      jobTitle: string
      interviewRate: number
      offerRate: number
      totalSubmissions: number
      medianDaysToResponse: number | null
      funnel: FunnelStage[]
      profileMatch: ProfileSignal[]
      insights: Insight[]
      topMissingSkills: string[]
      lastUpdated: string | null
    }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const companyId = searchParams.get("companyId") ?? ""
  const jobTitle  = searchParams.get("jobTitle")  ?? ""

  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 })

  // Optional — used for profile match signals
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const pool  = getPostgresPool()
  const norm  = normalizeTitle(jobTitle)

  // ── Company name ────────────────────────────────────────────────────────────
  const companyRes = await pool.query<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  )
  const companyName = companyRes.rows[0]?.name ?? ""

  // ── Pattern row ─────────────────────────────────────────────────────────────
  const patRes = await pool.query<{
    total_submissions: number
    phone_screen_rate: string | null
    technical_rate: string | null
    final_rate: string | null
    offer_rate: string | null
    median_days_to_response: number | null
    top_missing_skills: string[]
    referral_screen_rate: string | null
    cold_apply_screen_rate: string | null
    h1b_screen_rate: string | null
    citizen_screen_rate: string | null
    early_apply_screen_rate: string | null
    late_apply_screen_rate: string | null
    last_computed_at: string | null
  }>(
    `SELECT * FROM rejection_patterns
     WHERE company_id = $1 AND job_title_normalized = $2
     LIMIT 1`,
    [companyId, norm]
  )

  const pat = patRes.rows[0]
  const total = pat?.total_submissions ?? 0

  if (!pat || total < MIN_SUBMISSIONS) {
    return NextResponse.json({
      insufficientData: true,
      totalSubmissions: total,
      companyName,
      jobTitle,
    } satisfies PatternsResponse)
  }

  const toNum  = (v: string | null | undefined) => v != null ? Number(v) : null
  const toPct  = (v: string | null | undefined) => v != null ? Math.round(Number(v) * 100) : null

  const phoneRate    = toNum(pat.phone_screen_rate) ?? 0
  const techRate     = toNum(pat.technical_rate)    ?? 0
  const finalRate    = toNum(pat.final_rate)        ?? 0
  const offerRate    = toNum(pat.offer_rate)        ?? 0

  // ── Funnel ──────────────────────────────────────────────────────────────────
  const funnel: FunnelStage[] = [
    { stage: "applied",      label: "Applied",       count: total,                              rate: 100 },
    { stage: "phone_screen", label: "Phone screen",  count: Math.round(total * phoneRate),      rate: Math.round(phoneRate * 100) },
    ...(techRate > 0  ? [{ stage: "technical", label: "Technical",  count: Math.round(total * techRate),  rate: Math.round(techRate * 100) }] : []),
    ...(finalRate > 0 ? [{ stage: "final",     label: "Final round",count: Math.round(total * finalRate), rate: Math.round(finalRate * 100) }] : []),
    { stage: "offer",        label: "Offer",         count: Math.round(total * offerRate),      rate: Math.round(offerRate * 100) },
  ]

  // ── User profile for match signals ─────────────────────────────────────────
  let userVisa: string | null = null
  let userSkills: string[] = []
  if (user) {
    const [profileR, resumeR] = await Promise.all([
      pool.query<{ visa_status: string | null }>(
        `SELECT visa_status FROM profiles WHERE user_id = $1 LIMIT 1`,
        [user.id]
      ).catch(() => ({ rows: [] as { visa_status: string | null }[] })),
      pool.query<{ top_skills: string[] | null }>(
        `SELECT top_skills FROM resumes
         WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete'
         LIMIT 1`,
        [user.id]
      ).catch(() => ({ rows: [] as { top_skills: string[] | null }[] })),
    ])
    userVisa   = profileR.rows[0]?.visa_status ?? null
    userSkills = resumeR.rows[0]?.top_skills   ?? []
  }

  // ── Profile match signals ───────────────────────────────────────────────────
  const profileMatch: ProfileSignal[] = []

  // H-1B vs citizen screen rate
  const h1bPct = toPct(pat.h1b_screen_rate)
  const citPct = toPct(pat.citizen_screen_rate)
  if (h1bPct !== null && citPct !== null && (h1bPct > 0 || citPct > 0)) {
    const isH1b = userVisa === "h1b" || userVisa === "opt"
    const userRate = isH1b ? h1bPct : citPct
    const otherRate = isH1b ? citPct : h1bPct
    const delta = userRate - otherRate
    profileMatch.push({
      signal: "Visa / work authorization",
      youHaveIt: isH1b,
      percentWhoGotInHadIt: isH1b ? h1bPct : citPct,
      status: delta >= 0 ? "pass" : delta > -10 ? "warn" : "fail",
      icon: "travel_explore",
    })
  }

  // Referral impact
  const refPct  = toPct(pat.referral_screen_rate)
  const coldPct = toPct(pat.cold_apply_screen_rate)
  if (refPct !== null && coldPct !== null) {
    profileMatch.push({
      signal: "Internal referral",
      youHaveIt: false,  // unknown at query time
      percentWhoGotInHadIt: refPct,
      status: refPct > coldPct + 15 ? "warn" : "pass",
      icon: "people",
    })
  }

  // Early apply impact
  const earlyPct = toPct(pat.early_apply_screen_rate)
  const latePct  = toPct(pat.late_apply_screen_rate)
  if (earlyPct !== null && latePct !== null && earlyPct > latePct + 10) {
    profileMatch.push({
      signal: "Applied within 48 hours of posting",
      youHaveIt: false,
      percentWhoGotInHadIt: earlyPct,
      status: "warn",
      icon: "schedule",
    })
  }

  // Skill gaps
  const missingSkills = pat.top_missing_skills ?? []
  if (missingSkills.length > 0) {
    const userLower = userSkills.map(s => s.toLowerCase())
    const covered   = missingSkills.filter(s => userLower.some(u => u.includes(s.toLowerCase()) || s.toLowerCase().includes(u)))
    const pctHadThem = Math.round(phoneRate * 100)
    profileMatch.push({
      signal: `Key skills: ${missingSkills.slice(0, 3).join(", ")}`,
      youHaveIt: covered.length >= missingSkills.length * 0.5,
      percentWhoGotInHadIt: pctHadThem,
      status: covered.length >= missingSkills.length * 0.5 ? "pass" : "fail",
      icon: "code",
    })
  }

  // ── Insights ────────────────────────────────────────────────────────────────
  const insights: Insight[] = []

  if (refPct !== null && coldPct !== null && refPct > coldPct + 20) {
    insights.push({
      title: "Referrals drive interviews here",
      detail: `Referred candidates get through screening ${refPct - coldPct}pp more often. If you know someone inside, reach out before applying.`,
      stat: `${refPct}% referral vs ${coldPct}% cold`,
      severity: "warning",
      icon: "people",
    })
  }

  if (earlyPct !== null && latePct !== null && earlyPct > latePct + 15) {
    insights.push({
      title: "Speed matters — apply within 48 hours",
      detail: "Applicants who apply early get significantly more callbacks. Set a job alert for this company.",
      stat: `${earlyPct}% early vs ${latePct}% late`,
      severity: "positive",
      icon: "bolt",
    })
  }

  if (h1bPct !== null && citPct !== null && h1bPct < citPct - 15) {
    insights.push({
      title: "Visa sponsorship creates friction here",
      detail: "International candidates get fewer callbacks at this company. Consider companies with confirmed sponsorship history.",
      stat: `${h1bPct}% H-1B vs ${citPct}% citizen`,
      severity: "negative",
      icon: "travel_explore",
    })
  }

  if (phoneRate > 0.35) {
    insights.push({
      title: "Strong phone screen conversion",
      detail: `${Math.round(phoneRate * 100)}% of applicants make it to the first screen — above average for this role type. Resume quality is the main filter here.`,
      stat: `${Math.round(phoneRate * 100)}% pass rate`,
      severity: "positive",
      icon: "trending_up",
    })
  }

  if (pat.median_days_to_response) {
    insights.push({
      title: `Expect to wait ${pat.median_days_to_response} days`,
      detail: "Based on reported timelines from people who applied here. If you haven't heard back in twice that time, consider following up or moving on.",
      stat: `${pat.median_days_to_response}d median`,
      severity: pat.median_days_to_response > 21 ? "warning" : "positive",
      icon: "schedule",
    })
  }

  return NextResponse.json({
    insufficientData: false,
    companyName,
    jobTitle,
    interviewRate: Math.round(phoneRate * 100),
    offerRate: Math.round(offerRate * 100),
    totalSubmissions: total,
    medianDaysToResponse: pat.median_days_to_response,
    funnel,
    profileMatch,
    insights,
    topMissingSkills: missingSkills,
    lastUpdated: pat.last_computed_at,
  } satisfies PatternsResponse)
}
