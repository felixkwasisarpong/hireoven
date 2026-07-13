import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeVisibilityScore } from "@/lib/brand/visibility-scorer"
import { runBrandAudit, generateWeeklyActions } from "@/lib/brand/audit-engine"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"


/** Server-side plan gate — this endpoint exposes the paid "personal_brand" feature. */
async function requirePlanGate(userId: string) {
  const plan = await getPlanForUserId(userId)
  if (canAccess(plan, "personal_brand")) return null
  const needed = requiredPlanFor("personal_brand")
  return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
}

export const dynamic = "force-dynamic"
export const maxDuration = 30

type ResumeBrandSource = {
  linkedin_url: string | null
  primary_role: string | null
  summary: string | null
  top_skills: string[] | null
  skills: unknown
}

type BrandRow = {
  linkedin_url: string | null
  linkedin_connected: boolean | null
  headline: string | null
  has_about_section: boolean | null
  skills_count: number | null
  top_skills: string[] | null
  last_post_detected_at: string | null
  days_since_last_activity: number | null
}

type LinkedInHtmlFetch = {
  html: string | null
  reached: boolean
}

type PublicLinkedInScan = {
  headline: string | null
  profileReached: boolean
  activityReached: boolean
  daysSinceActivity: number | null
}

function normalizeLinkedInUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (host !== "linkedin.com") return null
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function metaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i")
  const match = html.match(re)
  return match?.[1] ? decodeHtml(match[1]) : null
}

function titleContent(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1] ? decodeHtml(match[1]) : null
}

function extractHeadlineFromLinkedInTitle(title: string | null): string | null {
  if (!title) return null
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s+-\s+LinkedIn\s*$/i, "")
    .trim()

  const parts = cleaned.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return parts.slice(1).join(" - ").slice(0, 180)
  return cleaned.length >= 35 ? cleaned.slice(0, 180) : null
}

function skillsFromResume(resume: ResumeBrandSource | null): string[] {
  const out = new Set<string>()
  for (const skill of resume?.top_skills ?? []) {
    if (typeof skill === "string" && skill.trim()) out.add(skill.trim())
  }

  const buckets = resume?.skills
  if (buckets && typeof buckets === "object") {
    for (const value of Object.values(buckets as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      for (const skill of value) {
        if (typeof skill === "string" && skill.trim()) out.add(skill.trim())
      }
    }
  }

  return [...out].slice(0, 20)
}

function isBlockedLinkedInResponse(response: Response, html: string): boolean {
  const finalUrl = response.url.toLowerCase()
  const lowerHtml = html.toLowerCase()
  return finalUrl.includes("/login")
    || finalUrl.includes("/authwall")
    || finalUrl.includes("/checkpoint")
    || finalUrl.includes("/uas/login")
    || lowerHtml.includes("authwall")
    || lowerHtml.includes("sign in to view")
}

async function fetchLinkedInHtml(url: string): Promise<LinkedInHtmlFetch> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HireovenBrandScanner/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    })

    if (!response.ok) return { html: null, reached: false }
    const html = await response.text()
    if (isBlockedLinkedInResponse(response, html)) {
      return { html: null, reached: false }
    }
    return { html, reached: true }
  } catch {
    return { html: null, reached: false }
  } finally {
    clearTimeout(timeout)
  }
}

function textFromHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
}

function relativeActivityDays(value: number, unit: string): number {
  const normalized = unit.toLowerCase()
  if (/^(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.test(normalized)) return 0
  if (/^(d|day|days)$/.test(normalized)) return value
  if (/^(w|wk|wks|week|weeks)$/.test(normalized)) return value * 7
  if (/^(mo|mos|month|months)$/.test(normalized)) return value * 30
  if (/^(y|yr|yrs|year|years)$/.test(normalized)) return value * 365
  return value
}

function daysSinceDate(value: string): number | null {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days < 0 || days > 3_650) return null
  return days
}

function extractDaysSinceActivity(html: string): number | null {
  const candidates: number[] = []
  const compactHtml = decodeHtml(html)
  const text = textFromHtml(html).toLowerCase()

  if (/\b(just now|today)\b/.test(text)) candidates.push(0)
  if (/\byesterday\b/.test(text)) candidates.push(1)

  const relativeRe = /\b(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\s*(?:ago)?\b/gi
  let relativeMatch: RegExpExecArray | null
  while ((relativeMatch = relativeRe.exec(text)) !== null) {
    const value = Number.parseInt(relativeMatch[1], 10)
    if (Number.isFinite(value)) {
      candidates.push(relativeActivityDays(value, relativeMatch[2]))
    }
  }

  const datetimeRe = /(?:datetime|datePublished|publishedAt|createdAt)["'\s:=]+(20\d{2}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?)/gi
  let datetimeMatch: RegExpExecArray | null
  while ((datetimeMatch = datetimeRe.exec(compactHtml)) !== null) {
    const days = daysSinceDate(datetimeMatch[1])
    if (days !== null) candidates.push(days)
  }

  return candidates.length > 0 ? Math.min(...candidates) : null
}

function activityUrls(profileUrl: string): string[] {
  const base = profileUrl.replace(/\/+$/, "")
  return [
    `${base}/recent-activity/all/`,
    `${base}/recent-activity/posts/`,
    `${base}/details/recent-activity/`,
  ]
}

async function scanPublicLinkedIn(url: string): Promise<PublicLinkedInScan> {
  const profileFetch = await fetchLinkedInHtml(url)
  const title = profileFetch.html
    ? metaContent(profileFetch.html, "og:title") ?? titleContent(profileFetch.html)
    : null
  const headline = extractHeadlineFromLinkedInTitle(title)

  const activityFetches = await Promise.all(activityUrls(url).map(fetchLinkedInHtml))
  const activityCandidates = activityFetches
    .filter((result) => result.html)
    .map((result) => extractDaysSinceActivity(result.html as string))
    .filter((days): days is number => days !== null)

  return {
    headline,
    profileReached: profileFetch.reached,
    activityReached: activityFetches.some((result) => result.reached),
    daysSinceActivity: activityCandidates.length > 0 ? Math.min(...activityCandidates) : null,
  }
}

function scanMessage(scan: PublicLinkedInScan): string {
  if (scan.headline && scan.daysSinceActivity !== null) {
    return "LinkedIn profile metadata and recent activity refreshed."
  }
  if (scan.daysSinceActivity !== null) {
    return "LinkedIn recent activity refreshed. Profile metadata was limited by LinkedIn."
  }
  if (scan.profileReached) {
    return "LinkedIn profile metadata refreshed. Recent activity was not publicly visible, so update days since activity manually if needed."
  }
  if (scan.activityReached) {
    return "LinkedIn activity page was reachable, but no recent activity date was visible. Update days since activity manually if needed."
  }
  return "LinkedIn public pages were not reachable, so Hireoven refreshed the score from your saved LinkedIn URL and resume data."
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const planGate = await requirePlanGate(user.id)
  if (planGate) return planGate

  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO public.user_brand_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  )

  const [brandResult, resumeResult] = await Promise.all([
    pool.query<BrandRow>(
      `SELECT linkedin_url, linkedin_connected, headline, has_about_section,
              skills_count, top_skills, last_post_detected_at, days_since_last_activity
       FROM public.user_brand_profiles
       WHERE user_id = $1`,
      [user.id]
    ),
    pool.query<ResumeBrandSource>(
      `SELECT linkedin_url, primary_role, summary, top_skills, skills
       FROM resumes
       WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [user.id]
    ),
  ])

  const brand = brandResult.rows[0] ?? null
  const resume = resumeResult.rows[0] ?? null
  const linkedinUrl = normalizeLinkedInUrl(brand?.linkedin_url ?? resume?.linkedin_url ?? "")

  if (!linkedinUrl) {
    return NextResponse.json(
      { error: "Add a valid LinkedIn profile URL before rescanning." },
      { status: 400 }
    )
  }

  const publicScan = await scanPublicLinkedIn(linkedinUrl)
  const resumeSkills = skillsFromResume(resume)
  const fallbackHeadline = [
    resume?.primary_role,
    resumeSkills.slice(0, 4).join(", "),
  ].filter(Boolean).join(" | ") || brand?.headline || null

  const nextHeadline = publicScan.headline ?? brand?.headline ?? fallbackHeadline
  const linkedinConnected = publicScan.profileReached || publicScan.activityReached || Boolean(brand?.linkedin_connected)
  const hasAboutSection = brand?.has_about_section ?? Boolean((resume?.summary ?? "").trim().length > 80)
  const skillsCount = Math.max(brand?.skills_count ?? 0, resumeSkills.length)
  const nextTopSkills = resumeSkills.length > 0 ? resumeSkills.slice(0, 12) : (brand?.top_skills ?? [])

  await pool.query(
    `UPDATE public.user_brand_profiles
     SET linkedin_url = $2,
         linkedin_connected = $3,
         linkedin_last_synced_at = now(),
         headline = COALESCE($4, headline),
         has_about_section = $5,
         skills_count = $6,
         top_skills = $7::text[],
         days_since_last_activity = COALESCE($8::integer, days_since_last_activity),
         last_post_detected_at = CASE
           WHEN $8::integer IS NULL THEN last_post_detected_at
           ELSE now() - ($8::integer * interval '1 day')
         END,
         updated_at = now()
     WHERE user_id = $1`,
    [
      user.id,
      linkedinUrl,
      linkedinConnected,
      nextHeadline,
      hasAboutSection,
      skillsCount,
      nextTopSkills,
      publicScan.daysSinceActivity,
    ]
  )

  const score = await computeVisibilityScore(user.id)
  const auditItems = await runBrandAudit(user.id, score)
  const weeklyActions = await generateWeeklyActions(user.id, score, auditItems)
  const profileResult = await pool.query(
    `SELECT * FROM public.user_brand_profiles WHERE user_id = $1`,
    [user.id]
  )

  return NextResponse.json({
    ok: true,
    profile: profileResult.rows[0] ?? null,
    score,
    auditItems,
    weeklyActions,
    scan: {
      source: publicScan.profileReached || publicScan.activityReached ? "linkedin_public" : "resume_fallback",
      message: scanMessage(publicScan),
    },
  })
}
