import { NextResponse } from "next/server"
import { analyzeOfferForNegotiation } from "@/lib/offers/offer-risk-analyzer"
import { generateCounterOffer } from "@/lib/offers/counter-offer-generator"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { OfferDetails as NegotiationOfferDetails, NegotiationUserProfile } from "@/lib/offers/types"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const {
    offerDetails,
    tone,
    companyId,
    roleTitle,
  } = body as {
    offerDetails?: NegotiationOfferDetails
    tone?: string
    companyId?: string
    roleTitle?: string
  }

  if (!offerDetails || !roleTitle) {
    return NextResponse.json({ error: "offerDetails and roleTitle are required" }, { status: 400 })
  }

  const validTones = new Set(["formal", "warm", "direct"])
  const userTone = validTones.has(tone ?? "") ? (tone as "formal" | "warm" | "direct") : "warm"

  // Fetch user profile for context (optional — best-effort)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const pool = getPostgresPool()
  let userProfile: NegotiationUserProfile = {}

  if (user) {
    const profileResult = await pool.query<{
      visa_status: string | null
      top_skills: string[] | null
      desired_locations: string[] | null
    }>(
      `SELECT p.visa_status, p.desired_locations,
              (SELECT top_skills FROM resumes
               WHERE user_id = p.id AND is_primary = true AND parse_status = 'complete'
               ORDER BY updated_at DESC LIMIT 1) AS top_skills
       FROM profiles p WHERE p.id = $1`,
      [user.id]
    )
    const p = profileResult.rows[0]
    if (p) {
      userProfile = {
        visaStatus: p.visa_status,
        location: p.desired_locations?.[0] ?? null,
        topSkills: p.top_skills ?? [],
      }
    }
  }

  try {
    const negotiationAnalysis = await analyzeOfferForNegotiation(
      offerDetails,
      companyId ?? "",
      roleTitle,
      userProfile
    )

    const counterOffer = await generateCounterOffer(
      negotiationAnalysis,
      userTone,
      userProfile.visaStatus ?? "unknown"
    )

    return NextResponse.json({ negotiationAnalysis, counterOffer })
  } catch (err) {
    console.error("[offers/counter-script] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to generate counter-offer" }, { status: 500 })
  }
}
