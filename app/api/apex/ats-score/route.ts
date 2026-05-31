import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { scoreResume } from "@/lib/apex/ats-score/scorer"

function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/apex/ats-score
 *
 * Body: { resumeText: string, jobDescription: string, jobTitle?: string }
 * Returns before/after breakdown if tailoredResumeText is also provided.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => null)
  if (!body?.resumeText || !body?.jobDescription) {
    return err(400, "resumeText and jobDescription are required")
  }

  const { resumeText, jobDescription, jobTitle = "", tailoredResumeText } = body

  const before = scoreResume(resumeText, jobDescription, jobTitle)
  const after  = tailoredResumeText
    ? scoreResume(tailoredResumeText, jobDescription, jobTitle)
    : null

  return NextResponse.json({ before, after, improvement: after ? after.total - before.total : null })
}
