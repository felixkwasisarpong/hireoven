import { getSessionUser } from "@/lib/auth/session-user"
import { fetchPipelineStatsForUser } from "@/lib/applications/pipeline-stats"
import type { PipelineStats } from "@/types"
import ApplicationsInsightsPageClient from "./ApplicationsInsightsPageClient"

export const dynamic = "force-dynamic"

type InsightsInitialData = {
  initialStats: PipelineStats | null
  initialLoaded: boolean
}

async function getInsightsInitialData(): Promise<InsightsInitialData> {
  const fallback: InsightsInitialData = {
    initialStats: null,
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    return {
      initialStats: await fetchPipelineStatsForUser(session.sub),
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function ApplicationInsightsPage() {
  const { initialStats, initialLoaded } = await getInsightsInitialData()
  return (
    <ApplicationsInsightsPageClient
      initialStats={initialStats}
      initialLoaded={initialLoaded}
    />
  )
}
