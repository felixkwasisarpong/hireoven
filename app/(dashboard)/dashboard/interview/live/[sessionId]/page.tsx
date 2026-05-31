import LiveInterviewRoom, {
  type JobInfo,
  type LiveInterviewRoomProps,
  type SessionMeta,
} from "@/components/interview/LiveInterviewRoom"
import { getSessionUser } from "@/lib/auth/session-user"
import { canAccess } from "@/lib/gates"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { deriveSkillList } from "@/lib/apex/interview/context"
import {
  getInterviewSession,
  getTurns,
  type InterviewSession,
  type InterviewTurn,
} from "@/lib/apex/interview/queries"

export const dynamic = "force-dynamic"

function serializeSession(
  session: InterviewSession,
  metadata: Record<string, unknown>,
  skillList: string[]
): SessionMeta {
  return {
    persona: session.persona,
    questionSet: session.questionSet,
    status: session.status,
    durationTargetMin: session.durationTargetMin,
    jobId: session.jobId,
    startedAt: session.startedAt?.toISOString() ?? null,
    skillList,
    metadata: metadata as SessionMeta["metadata"],
  }
}

function deriveCoveredSkills(turns: InterviewTurn[]): string[] {
  return [
    ...new Set(
      turns
        .filter((turn) => turn.role === "interviewer")
        .map((turn) => (turn.metadata as { skill_tag?: string | null } | undefined)?.skill_tag)
        .filter((skill): skill is string => Boolean(skill))
    ),
  ]
}

async function getInitialData(sessionId: string): Promise<LiveInterviewRoomProps> {
  const fallback: LiveInterviewRoomProps = {
    sessionId,
    initialLoaded: false,
    initialSession: null,
    initialJobInfo: null,
    initialSkillsCovered: [],
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) return fallback

    const plan = await getPlanForUserId(user.sub)
    if (!canAccess(plan, "interview_live")) return fallback

    const session = await getInterviewSession(sessionId, user.sub)
    if (!session || session.type !== "live") return fallback

    const pool = getPostgresPool()

    const [turns, metadataResult, jobResult] = await Promise.all([
      getTurns(sessionId),
      pool.query<{ metadata: Record<string, unknown> | null }>(
        `SELECT metadata FROM interview_sessions WHERE id = $1`,
        [sessionId],
      ),
      session.jobId
        ? pool.query<{ title: string | null; company_name: string | null; skills: string[] | null }>(
            `SELECT j.title, c.name AS company_name, j.skills
             FROM jobs j
             LEFT JOIN companies c ON c.id = j.company_id
             WHERE j.id = $1
             LIMIT 1`,
            [session.jobId],
          )
        : Promise.resolve({ rows: [] } as { rows: Array<{ title: string | null; company_name: string | null; skills: string[] | null }> }),
    ])

    const metadata = metadataResult.rows[0]?.metadata ?? {}
    const jobTopSkills = jobResult.rows[0]?.skills ?? []
    const skillList = deriveSkillList(session.questionSet, jobTopSkills)

    const jobTitle = jobResult.rows[0]?.title ?? null
    const jobCompany = jobResult.rows[0]?.company_name ?? null
    const initialJobInfo: JobInfo | null = jobTitle
      ? { title: jobTitle, company: jobCompany }
      : null

    return {
      sessionId,
      initialLoaded: true,
      initialSession: serializeSession(session, metadata, skillList),
      initialJobInfo,
      initialSkillsCovered: deriveCoveredSkills(turns),
    }
  } catch {
    return fallback
  }
}

export default async function LiveInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const initialData = await getInitialData(sessionId)

  return (
    <div className="flex h-full flex-col" style={{ height: "100dvh" }}>
      <LiveInterviewRoom {...initialData} />
    </div>
  )
}
