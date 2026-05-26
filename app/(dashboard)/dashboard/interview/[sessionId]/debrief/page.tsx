import { getSessionUser } from "@/lib/auth/session-user"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateDebrief } from "@/lib/scout/interview/debriefGenerator"
import {
  getDebrief,
  getInterviewSession,
  getTurns,
  type InterviewDebrief,
  type InterviewSession,
  type InterviewTurn,
} from "@/lib/scout/interview/queries"
import DebriefPageClient, {
  type DebriefData,
  type DebriefPageClientProps,
  type SessionData,
  type TurnData,
} from "./DebriefPageClient"

export const dynamic = "force-dynamic"

type CodingAttemptPreview = {
  codeSnapshots: Array<{ ts: number; code: string }>
  languageUsed: string | null
  finalCode: string | null
}

function serializeSession(
  session: InterviewSession,
  metadata: Record<string, unknown>
): SessionData {
  return {
    id: session.id,
    type: session.type,
    persona: session.persona,
    status: session.status,
    durationTargetMin: session.durationTargetMin,
    jobId: session.jobId,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    metadata: metadata as SessionData["metadata"],
  }
}

function serializeDebrief(
  debrief: InterviewDebrief
): DebriefData {
  return {
    overallScore: debrief.overallScore,
    headline: debrief.headline,
    strengths: debrief.strengths as DebriefData["strengths"],
    gaps: debrief.gaps as DebriefData["gaps"],
    sampleBetterAnswers: debrief.sampleBetterAnswers as DebriefData["sampleBetterAnswers"],
    codingFeedback: debrief.codingFeedback as DebriefData["codingFeedback"],
    voiceFeedback: debrief.voiceFeedback as DebriefData["voiceFeedback"],
    deliverySignals: debrief.deliverySignals as DebriefData["deliverySignals"],
    recommendedNext: debrief.recommendedNext as DebriefData["recommendedNext"],
    generatedAt: debrief.generatedAt.toISOString(),
  }
}

function serializeTurns(turns: InterviewTurn[]): TurnData[] {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    content: turn.content,
    turnIndex: turn.turnIndex,
  }))
}

async function getInitialData(sessionId: string): Promise<DebriefPageClientProps> {
  const fallback: DebriefPageClientProps = {
    sessionId,
    initialLoaded: false,
    initialDebrief: null,
    initialSession: null,
    initialTurns: [],
    initialJobTitle: null,
    initialJobCompany: null,
    initialFinalCode: null,
    initialLanguage: undefined,
    initialSnapshotCount: 0,
    initialError: null,
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) {
      return {
        ...fallback,
        initialLoaded: true,
        initialError: "Unauthorized",
      }
    }

    const plan = await getPlanForUserId(user.sub)
    if (!canAccess(plan, "interview_prep")) {
      const needed = requiredPlanFor("interview_prep")
      return {
        ...fallback,
        initialLoaded: true,
        initialError: `This feature requires the ${needed} plan`,
      }
    }

    const session = await getInterviewSession(sessionId, user.sub)
    if (!session) {
      return {
        ...fallback,
        initialLoaded: true,
        initialError: "Not found",
      }
    }

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

    let debrief = await getDebrief(sessionId)

    if (!debrief || debrief.overallScore === null) {
      if (session.status === "completed") {
        try {
          debrief = await generateDebrief(sessionId)
        } catch (error) {
          console.error("[debrief page] generation failed", error)
          if (!debrief) {
            return {
              ...fallback,
              initialLoaded: true,
              initialError: "Debrief generation failed",
            }
          }
        }
      } else if (!debrief) {
        return {
          ...fallback,
          initialLoaded: true,
          initialSession: serializeSession(session, metadataResult.rows[0]?.metadata ?? {}),
          initialError: "Debrief not yet available",
        }
      }
    }

    const [turns, attemptResult] = await Promise.all([
      getTurns(sessionId),
      session.type === "coding"
        ? pool.query<{
            codeSnapshots: Array<{ ts: number; code: string }> | null
            languageUsed: string | null
            finalCode: string | null
          }>(
            `SELECT
               code_snapshots AS "codeSnapshots",
               language_used AS "languageUsed",
               final_code AS "finalCode"
             FROM coding_attempts
             WHERE session_id = $1
             LIMIT 1`,
            [sessionId],
          )
        : Promise.resolve({ rows: [] } as { rows: CodingAttemptPreview[] }),
    ])

    const metadata = metadataResult.rows[0]?.metadata ?? {}
    const jobTitle = jobResult.rows[0]?.title ?? null
    const jobCompany = jobResult.rows[0]?.company_name ?? null
    const codingAttempt = attemptResult.rows[0]

    return {
      sessionId,
      initialLoaded: true,
      initialDebrief: debrief ? serializeDebrief(debrief) : null,
      initialSession: serializeSession(session, metadata),
      initialTurns: serializeTurns(turns),
      initialJobTitle: jobTitle,
      initialJobCompany: jobCompany,
      initialFinalCode: codingAttempt?.finalCode ?? null,
      initialLanguage: codingAttempt?.languageUsed ?? undefined,
      initialSnapshotCount: codingAttempt?.codeSnapshots?.length ?? 0,
      initialError: null,
    }
  } catch (error) {
    console.error("[debrief page] preload failed", error)
    return fallback
  }
}

export default async function DebriefPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const initialData = await getInitialData(sessionId)

  return <DebriefPageClient {...initialData} />
}
