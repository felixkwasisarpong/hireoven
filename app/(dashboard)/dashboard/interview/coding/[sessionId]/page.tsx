import LiveCodingWorkspace, {
  type JobInfo,
  type LiveCodingWorkspaceProps,
  type SessionMeta,
} from "@/components/interview/LiveCodingWorkspace"
import { getSessionUser } from "@/lib/auth/session-user"
import { canAccess } from "@/lib/gates"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession, type InterviewSession } from "@/lib/scout/interview/queries"

export const dynamic = "force-dynamic"

function serializeSession(
  session: InterviewSession,
  metadata: Record<string, unknown>
): SessionMeta {
  return {
    persona: session.persona,
    questionSet: session.questionSet,
    status: session.status,
    durationTargetMin: session.durationTargetMin,
    jobId: session.jobId,
    startedAt: session.startedAt?.toISOString() ?? null,
    metadata: metadata as SessionMeta["metadata"],
  }
}

async function getInitialData(sessionId: string): Promise<LiveCodingWorkspaceProps> {
  const fallback: LiveCodingWorkspaceProps = {
    sessionId,
    initialLoaded: false,
    initialSession: null,
    initialJobInfo: null,
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) return fallback

    const plan = await getPlanForUserId(user.sub)
    if (!canAccess(plan, "interview_prep")) return fallback

    const session = await getInterviewSession(sessionId, user.sub)
    if (!session || session.type !== "coding") return fallback

    const pool = getPostgresPool()
    const [metadataResult, jobResult] = await Promise.all([
      pool.query<{ metadata: Record<string, unknown> | null }>(
        `SELECT metadata FROM interview_sessions WHERE id = $1`,
        [sessionId],
      ),
      session.jobId
        ? pool.query<{ title: string | null; company_name: string | null }>(
            `SELECT j.title, c.name AS company_name
             FROM jobs j
             LEFT JOIN companies c ON c.id = j.company_id
             WHERE j.id = $1
             LIMIT 1`,
            [session.jobId],
          )
        : Promise.resolve({ rows: [] } as { rows: Array<{ title: string | null; company_name: string | null }> }),
    ])

    const metadata = metadataResult.rows[0]?.metadata ?? {}
    const jobTitle = jobResult.rows[0]?.title ?? null
    const jobCompany = jobResult.rows[0]?.company_name ?? null
    const initialJobInfo: JobInfo | null = jobTitle
      ? { title: jobTitle, company: jobCompany }
      : null

    return {
      sessionId,
      initialLoaded: true,
      initialSession: serializeSession(session, metadata),
      initialJobInfo,
    }
  } catch {
    return fallback
  }
}

export default async function CodingInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const initialData = await getInitialData(sessionId)

  return (
    <div className="flex h-full flex-col" style={{ height: "100dvh" }}>
      <LiveCodingWorkspace {...initialData} />
    </div>
  )
}
