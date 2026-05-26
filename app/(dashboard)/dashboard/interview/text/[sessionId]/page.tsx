import TextInterviewChat, {
  type JobData,
  type SessionData,
  type TextInterviewChatProps,
  type TurnData,
} from "@/components/interview/TextInterviewChat"
import { getSessionUser } from "@/lib/auth/session-user"
import { canAccess } from "@/lib/gates"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { deriveSkillList } from "@/lib/scout/interview/context"
import {
  getInterviewSession,
  getTurns,
  type InterviewSession,
  type InterviewTurn,
} from "@/lib/scout/interview/queries"

export const dynamic = "force-dynamic"

function serializeSession(
  session: InterviewSession,
  metadata: Record<string, unknown>
): SessionData {
  return {
    id: session.id,
    type: session.type,
    persona: session.persona,
    questionSet: session.questionSet,
    status: session.status,
    durationTargetMin: session.durationTargetMin,
    jobId: session.jobId,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    metadata: metadata as SessionData["metadata"],
  }
}

function serializeTurns(turns: InterviewTurn[]): TurnData[] {
  return turns
    .filter((turn) => turn.role !== "system")
    .map((turn) => ({
      id: turn.id,
      role: turn.role as "interviewer" | "candidate",
      content: turn.content,
      turnIndex: turn.turnIndex,
      skillTag:
        (turn.metadata as { skill_tag?: string | null } | undefined)?.skill_tag ??
        null,
    }))
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

async function getInitialData(sessionId: string): Promise<TextInterviewChatProps> {
  const fallback: TextInterviewChatProps = {
    sessionId,
    initialLoaded: false,
    initialSession: null,
    initialJob: null,
    initialTurns: [],
    initialSkillList: [],
    initialSkillsCovered: [],
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) return fallback

    const plan = await getPlanForUserId(user.sub)
    if (!canAccess(plan, "interview_prep")) return fallback

    const session = await getInterviewSession(sessionId, user.sub)
    if (!session) return fallback

    const pool = getPostgresPool()

    const [turns, metadataResult, resumeSkillsResult, jobResult] = await Promise.all([
      getTurns(sessionId),
      pool.query<{ metadata: Record<string, unknown> | null }>(
        `SELECT metadata FROM interview_sessions WHERE id = $1`,
        [sessionId],
      ),
      session.jobId
        ? pool.query<{ top_skills: string[] | null }>(
            `SELECT top_skills
             FROM resumes
             WHERE user_id = $1
               AND parse_status = 'parsed'
             LIMIT 1`,
            [user.sub],
          )
        : Promise.resolve({ rows: [] } as { rows: Array<{ top_skills: string[] | null }> }),
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
    const practiceDerivedSkills =
      (metadata.practice_focus as { derived_skills?: string[] } | null | undefined)?.derived_skills
    const jobTopSkills = resumeSkillsResult.rows[0]?.top_skills ?? []

    const initialSkillList = practiceDerivedSkills?.length
      ? practiceDerivedSkills
      : deriveSkillList(session.questionSet, jobTopSkills)

    const jobTitle = jobResult.rows[0]?.title ?? null
    const jobCompany = jobResult.rows[0]?.company_name ?? null
    const initialJob: JobData | null = jobTitle
      ? { title: jobTitle, company: jobCompany }
      : null

    return {
      sessionId,
      initialLoaded: true,
      initialSession: serializeSession(session, metadata),
      initialJob,
      initialTurns: serializeTurns(turns),
      initialSkillList,
      initialSkillsCovered: deriveCoveredSkills(turns),
    }
  } catch {
    return fallback
  }
}

export default async function TextInterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const initialData = await getInitialData(sessionId)

  return (
    <div className="flex h-full flex-col" style={{ height: "calc(100dvh - 57px)" }}>
      <TextInterviewChat {...initialData} />
    </div>
  )
}
