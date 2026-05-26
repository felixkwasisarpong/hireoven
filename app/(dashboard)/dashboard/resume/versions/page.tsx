import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { fetchResumeVersionsWithOutcomeStats } from "@/lib/resume/version-outcomes"
import type { Resume, ResumeVersion } from "@/types"
import ResumeVersionsPageClient from "./ResumeVersionsPageClient"

export const dynamic = "force-dynamic"

type ResumeVersionsInitialData = {
  initialPrimaryResume: Resume | null
  initialVersions: ResumeVersion[]
  initialLoaded: boolean
}

async function getInitialData(): Promise<ResumeVersionsInitialData> {
  const fallback: ResumeVersionsInitialData = {
    initialPrimaryResume: null,
    initialVersions: [],
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const pool = getPostgresPool()

    const primaryResumeResult = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1::uuid
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [session.sub],
    )

    const initialPrimaryResume = primaryResumeResult.rows[0] ?? null
    if (!initialPrimaryResume) {
      return {
        initialPrimaryResume: null,
        initialVersions: [],
        initialLoaded: true,
      }
    }

    const versionsTableResult = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.resume_versions') IS NOT NULL AS exists`,
    )

    if (!versionsTableResult.rows[0]?.exists) {
      return {
        initialPrimaryResume,
        initialVersions: [],
        initialLoaded: true,
      }
    }

    const versionsResult = await fetchResumeVersionsWithOutcomeStats({
      pool,
      resumeId: initialPrimaryResume.id,
      userId: session.sub,
    })

    return {
      initialPrimaryResume,
      initialVersions: versionsResult,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function ResumeVersionsPage() {
  const { initialPrimaryResume, initialVersions, initialLoaded } = await getInitialData()

  return (
    <ResumeVersionsPageClient
      initialPrimaryResume={initialPrimaryResume}
      initialVersions={initialVersions}
      initialLoaded={initialLoaded}
    />
  )
}
