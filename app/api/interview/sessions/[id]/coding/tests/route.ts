import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

/**
 * Returns hidden tests for the active coding session's problem.
 *
 * Security note: tests are delivered to the client because execution is
 * in-browser. A determined user can read them from network devtools.
 * This is a practice tool — the honor system is sufficient here.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  const result = await pool.query<{
    problem_id: string
    hidden_tests: Array<{ input: unknown[]; expected: unknown; weight: number }>
    slug: string
    fn_name_python: string
    fn_name_js: string
    function_signature: { python?: string; javascript?: string }
  }>(
    `SELECT cp.id AS problem_id, cp.hidden_tests, cp.slug, cp.function_signature
     FROM coding_attempts ca
     JOIN coding_problems cp ON cp.id = ca.problem_id
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.id = $1 AND s.user_id = $2 AND s.status = 'active'
     LIMIT 1`,
    [id, user.id]
  )

  if (!result.rows[0]) {
    return NextResponse.json({ error: "No active coding session" }, { status: 404 })
  }

  const { hidden_tests, slug, function_signature } = result.rows[0]

  // Extract function name from signature
  const pyMatch = (function_signature.python ?? "").match(/def (\w+)\s*\(/)
  const jsMatch = (function_signature.javascript ?? "").match(/function\s+(\w+)\s*\(/) ??
    (function_signature.javascript ?? "").match(/class\s+(\w+)\s*/)
  const pythonFnName = pyMatch?.[1] ?? "solution"
  const jsFnName = jsMatch?.[1] ?? "solution"

  return NextResponse.json({
    tests: hidden_tests,
    slug,
    pythonFnName,
    jsFnName,
  })
}
