import { getSessionUser } from "@/lib/auth/session-user"
import {
  fetchAutofillHistoryForUser,
  type AutofillHistorySummary,
} from "@/lib/autofill/history"
import AutofillHistoryPageClient from "./AutofillHistoryPageClient"

export const dynamic = "force-dynamic"

type AutofillHistoryInitialData = {
  initialHistory: AutofillHistorySummary["history"]
  initialStats: {
    totalApplications: number
    avgFillRate: number
    minutesSaved: number
  }
  initialLoaded: boolean
}

async function getInitialData(): Promise<AutofillHistoryInitialData> {
  const fallback: AutofillHistoryInitialData = {
    initialHistory: [],
    initialStats: {
      totalApplications: 0,
      avgFillRate: 0,
      minutesSaved: 0,
    },
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const summary = await fetchAutofillHistoryForUser(session.sub)
    return {
      initialHistory: summary.history,
      initialStats: {
        totalApplications: summary.totalApplications,
        avgFillRate: summary.avgFillRate,
        minutesSaved: summary.minutesSaved,
      },
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function AutofillHistoryPage() {
  const { initialHistory, initialStats, initialLoaded } = await getInitialData()

  return (
    <AutofillHistoryPageClient
      initialHistory={initialHistory}
      initialStats={initialStats}
      initialLoaded={initialLoaded}
    />
  )
}
