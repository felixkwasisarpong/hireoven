import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Resume } from "@/types"
import ResumeScorePageClient from "./ResumeScorePageClient"

export const dynamic = "force-dynamic"

type ResumeScoreInitialData = {
  initialPrimaryResume: Resume | null
  initialLoaded: boolean
}

async function getInitialData(): Promise<ResumeScoreInitialData> {
  const fallback: ResumeScoreInitialData = {
    initialPrimaryResume: null,
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const pool = getPostgresPool()
    const result = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1::uuid
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [session.sub],
    )

    return {
      initialPrimaryResume: result.rows[0] ?? null,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function ResumeScorePage() {
  const { initialPrimaryResume, initialLoaded } = await getInitialData()

  return (
    <ResumeScorePageClient
      initialPrimaryResume={initialPrimaryResume}
      initialLoaded={initialLoaded}
    />
  )
}
