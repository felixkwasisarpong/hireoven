/**
 * GET/PATCH /api/extension/brand/profile
 *
 * Extension-authenticated Brand profile sync. The browser extension can read the
 * user's own LinkedIn page while they are logged in, so this is the preferred
 * source before public LinkedIn metadata fallback.
 */

import { NextResponse } from "next/server"
import { computeVisibilityScore } from "@/lib/brand/visibility-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type LinkedInBrandPatch = {
  linkedin_url?: unknown
  headline?: unknown
  has_about_section?: unknown
  skills_count?: unknown
  recommendations_count?: unknown
  estimated_connections?: unknown
  last_post_detected_at?: unknown
  days_since_last_activity?: unknown
}

function normalizeLinkedInProfileUrl(input: unknown): string | null {
  if (typeof input !== "string") return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (host !== "linkedin.com") return null
    const match = url.pathname.match(/^\/in\/([^/?#]+)/i)
    if (!match) return null
    return `https://www.linkedin.com/in/${match[1].replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

function isLinkedInActivityPage(input: unknown): boolean {
  return typeof input === "string" && /\/(?:recent-activity|details\/recent-activity)(?:\/|$)/i.test(input)
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function cleanNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function cleanIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))
  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO public.user_brand_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.sub]
  )
  const result = await pool.query(
    `SELECT * FROM public.user_brand_profiles WHERE user_id = $1`,
    [user.sub]
  )
  return NextResponse.json({ profile: result.rows[0] ?? null }, { headers: corsHeaders })
}

export async function PATCH(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))
  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<LinkedInBrandPatch>(request)
  if (bodyError) return bodyError

  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO public.user_brand_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.sub]
  )

  const updates: Record<string, unknown> = {
    linkedin_connected: true,
    linkedin_last_synced_at: new Date().toISOString(),
  }
  const normalizedUrl = normalizeLinkedInProfileUrl(body.linkedin_url)
  const activityPage = isLinkedInActivityPage(body.linkedin_url)
  if (normalizedUrl) updates.linkedin_url = normalizedUrl

  const daysSinceActivity = cleanNumber(body.days_since_last_activity)
  const lastPostDetectedAt = cleanIsoDate(body.last_post_detected_at)
  if (daysSinceActivity !== null) {
    updates.days_since_last_activity = daysSinceActivity
    updates.last_post_detected_at = new Date(Date.now() - daysSinceActivity * 86_400_000).toISOString()
  } else if (lastPostDetectedAt) {
    updates.last_post_detected_at = lastPostDetectedAt
  }

  if (!activityPage) {
    const headline = cleanString(body.headline, 180)
    const skillsCount = cleanNumber(body.skills_count)
    const recommendationsCount = cleanNumber(body.recommendations_count)
    const estimatedConnections = cleanNumber(body.estimated_connections)

    if (headline) updates.headline = headline
    if (typeof body.has_about_section === "boolean") updates.has_about_section = body.has_about_section
    if (skillsCount !== null) updates.skills_count = skillsCount
    if (recommendationsCount !== null) updates.recommendations_count = recommendationsCount
    if (estimatedConnections !== null) updates.estimated_connections = estimatedConnections
  }

  const entries = Object.entries(updates)
  if (entries.length === 0) {
    return extensionError(request, 400, "Nothing to update", { headers: corsHeaders })
  }

  const values = entries.map(([, value]) => value)
  values.push(user.sub)
  const setSql = entries.map(([key], index) => `${key} = $${index + 1}`)

  await pool.query(
    `UPDATE public.user_brand_profiles
     SET ${setSql.join(", ")}, updated_at = now()
     WHERE user_id = $${values.length}`,
    values
  )

  const score = await computeVisibilityScore(user.sub)
  const profileResult = await pool.query(
    `SELECT * FROM public.user_brand_profiles WHERE user_id = $1`,
    [user.sub]
  )

  return NextResponse.json(
    {
      ok: true,
      source: "extension_linkedin",
      profile: profileResult.rows[0] ?? null,
      score,
    },
    { headers: corsHeaders }
  )
}
