import { ClipboardList } from "lucide-react"
import HistoryTable from "@/components/interview/HistoryTable"
import { getSessionUser } from "@/lib/auth/session-user"
import { listRecentSessions } from "@/lib/scout/interview/queries"

export const dynamic = "force-dynamic"

type HistorySession = {
  id: string
  type: string
  persona: string
  status: string
  durationTargetMin: number
  jobId: string | null
  jobTitle: string | null
  jobCompany: string | null
  createdAt: string
  startedAt: string | null
  debrief: { overallScore: number | null } | null
}

type HistoryInitialData = {
  sessions: HistorySession[]
  loaded: boolean
}

async function getHistoryInitialData(): Promise<HistoryInitialData> {
  const fallback: HistoryInitialData = {
    sessions: [],
    loaded: false,
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) return { sessions: [], loaded: true }

    const sessions = await listRecentSessions(user.sub, 200)
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        type: session.type,
        persona: session.persona,
        status: session.status,
        durationTargetMin: session.durationTargetMin,
        jobId: session.jobId,
        jobTitle: session.jobTitle,
        jobCompany: session.jobCompany,
        createdAt: session.createdAt.toISOString(),
        startedAt: session.startedAt?.toISOString() ?? null,
        debrief: session.debrief ? { overallScore: session.debrief.overallScore } : null,
      })),
      loaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function InterviewHistoryPage() {
  const initialData = await getHistoryInitialData()

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
          <ClipboardList className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Interview history</h1>
          <p className="text-[13px] text-slate-500">
            Every session you&apos;ve run. Filter, review, repeat.
          </p>
        </div>
      </div>

      <HistoryTable
        initialSessions={initialData.sessions}
        initialLoaded={initialData.loaded}
      />
    </div>
  )
}
