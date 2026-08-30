/**
 * The questions auto-apply could not answer, and the answers to them.
 *
 * Coverage stalls not because forms cannot be driven but because employers ask
 * things no résumé contains — "Are you 18 years old or older?", "Are you living
 * in the United States at present?". Each one is asked once here and reused on
 * every later application, which is what turns a recurring blocker into a
 * one-time setup cost.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getPendingQuestions,
  saveScreeningAnswer,
} from "@/lib/autofill/screening-answers"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const questions = await getPendingQuestions(user.id, 25)
  return NextResponse.json({ questions })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null) as
    | { id?: string; answer?: string }
    | null
  const id = body?.id?.trim()
  const answer = body?.answer?.trim()
  if (!id || !answer) {
    return NextResponse.json({ error: "id and answer are required" }, { status: 400 })
  }
  // saveScreeningAnswer scopes the update by user_id, so one user cannot answer
  // another's question by guessing an id.
  const ok = await saveScreeningAnswer(user.id, id, answer)
  if (!ok) return NextResponse.json({ error: "Question not found" }, { status: 404 })
  return NextResponse.json({ saved: true })
}
