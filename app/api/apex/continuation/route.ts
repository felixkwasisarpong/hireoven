import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  isEmptyContinuationState,
  sanitizeContinuationState,
} from "@/lib/scout/continuation/sanitize"
import type {
  ScoutContinuationApiResponse,
  ScoutContinuationState,
} from "@/lib/scout/continuation/types"

export const runtime = "nodejs"

const CONTINUATION_COLUMN = "scout_continuation_state"

type ContinuationRow = {
  scout_continuation_state: unknown
  updated_at: string | null
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const code = (error as { code?: unknown }).code
  const message = (error as { message?: unknown }).message

  if (typeof code === "string" && code === "42703") return true
  if (typeof message === "string" && message.includes(CONTINUATION_COLUMN)) return true

  return false
}

function okResponse(state: ScoutContinuationState | null, updatedAt?: string | null) {
  const body: ScoutContinuationApiResponse = {
    state,
    updatedAt: updatedAt ?? null,
  }
  return NextResponse.json(body)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  try {
    const result = await pool.query<ContinuationRow>(
      `SELECT scout_continuation_state, updated_at
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [user.id],
    )

    const row = result.rows[0]
    if (!row) return okResponse(null, null)

    if (!row.scout_continuation_state) {
      return okResponse(null, row.updated_at)
    }

    const clean = sanitizeContinuationState(row.scout_continuation_state)
    return okResponse(isEmptyContinuationState(clean) ? null : clean, row.updated_at)
  } catch (error) {
    if (isMissingColumnError(error)) {
      return okResponse(null, null)
    }
    console.error("[scout/continuation] GET failed:", error)
    return NextResponse.json({ error: "Unable to read continuation state" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { state?: unknown } | null
  const parsed = body?.state == null ? null : sanitizeContinuationState(body.state)
  const state = parsed && !isEmptyContinuationState(parsed) ? parsed : null

  const pool = getPostgresPool()

  try {
    const result = await pool.query<{ updated_at: string }>(
      `INSERT INTO profiles (id, email, scout_continuation_state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
       SET scout_continuation_state = EXCLUDED.scout_continuation_state,
           updated_at = NOW()
       RETURNING updated_at`,
      [user.id, user.email ?? null, state ? JSON.stringify(state) : null],
    )

    return okResponse(state, result.rows[0]?.updated_at ?? null)
  } catch (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "Continuation column missing. Run migration add-profiles-scout-continuation-state.sql" },
        { status: 503 },
      )
    }

    console.error("[scout/continuation] PUT failed:", error)
    return NextResponse.json({ error: "Unable to save continuation state" }, { status: 500 })
  }
}
