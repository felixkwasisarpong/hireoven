import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { aggregateCohortStats } from "@/lib/cohorts/aggregator"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cohortId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { voucheeId, relationship, note } = body

  if (!voucheeId || typeof voucheeId !== "string") {
    return NextResponse.json({ error: "voucheeId is required" }, { status: 400 })
  }
  if (voucheeId === user.id) {
    return NextResponse.json({ error: "You cannot vouch for yourself" }, { status: 400 })
  }
  if (!relationship || typeof relationship !== "string") {
    return NextResponse.json({ error: "relationship is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Verify both voucher and vouchee are members of this cohort
  const memberCheck = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM public.cohort_members
     WHERE cohort_id = $1 AND user_id = ANY($2::uuid[])`,
    [cohortId, [user.id, voucheeId]]
  )
  const memberIds = memberCheck.rows.map((r) => r.user_id)
  if (!memberIds.includes(user.id)) {
    return NextResponse.json({ error: "You must be a member of this cohort to vouch" }, { status: 403 })
  }
  if (!memberIds.includes(voucheeId)) {
    return NextResponse.json({ error: "The person you are vouching for is not in this cohort" }, { status: 400 })
  }

  try {
    await pool.query(
      `INSERT INTO public.cohort_vouches (cohort_id, voucher_id, vouchee_id, relationship, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [cohortId, user.id, voucheeId, relationship, note ?? null]
    )

    // Increment counters on both members
    await pool.query(
      `UPDATE public.cohort_members SET vouches_received = vouches_received + 1
       WHERE cohort_id = $1 AND user_id = $2`,
      [cohortId, voucheeId]
    )
    await pool.query(
      `UPDATE public.cohort_members SET vouches_given = vouches_given + 1
       WHERE cohort_id = $1 AND user_id = $2`,
      [cohortId, user.id]
    )

    aggregateCohortStats(cohortId).catch((err) =>
      console.error("[cohorts/vouch] aggregation failed:", err instanceof Error ? err.message : err)
    )

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const pg = err as { code?: string }
    if (pg.code === "23505") {
      return NextResponse.json({ error: "You have already vouched for this person" }, { status: 409 })
    }
    if (pg.code === "23514") {
      return NextResponse.json({ error: "You cannot vouch for yourself" }, { status: 400 })
    }
    console.error("[cohorts/vouch] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to submit vouch" }, { status: 500 })
  }
}
