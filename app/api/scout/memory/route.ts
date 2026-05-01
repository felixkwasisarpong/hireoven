/**
 * GET  /api/scout/memory  — list all memories for the authenticated user
 * POST /api/scout/memory  — create a new memory (explicit user or bulk-extracted)
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getMemories, createMemory } from "@/lib/scout/memory/store"
import { VALID_MEMORY_CATEGORIES, VALID_MEMORY_SOURCES } from "@/lib/scout/memory/types"
import type { ScoutMemoryCategory, ScoutMemorySource } from "@/lib/scout/memory/types"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const memories = await getMemories(user.id, pool)
  return NextResponse.json({ memories })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  type Body = {
    category?: string
    summary?: string
    confidence?: number
    source?: string
  }

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.category || !body?.summary) {
    return NextResponse.json({ error: "category and summary are required" }, { status: 400 })
  }

  if (!VALID_MEMORY_CATEGORIES.has(body.category as ScoutMemoryCategory)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 })
  }

  const source: ScoutMemorySource = VALID_MEMORY_SOURCES.has(body.source as ScoutMemorySource)
    ? (body.source as ScoutMemorySource)
    : "explicit_user"

  const pool = getPostgresPool()
  const memory = await createMemory(user.id, pool, {
    category:   body.category as ScoutMemoryCategory,
    summary:    body.summary,
    confidence: typeof body.confidence === "number" ? body.confidence : 1.0,
    source,
  })

  if (!memory) {
    return NextResponse.json(
      { error: "Could not create memory — check limits or invalid input" },
      { status: 422 },
    )
  }

  return NextResponse.json({ memory }, { status: 201 })
}
