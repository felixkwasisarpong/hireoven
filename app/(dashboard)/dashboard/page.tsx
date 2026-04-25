import { Suspense } from "react"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import DashboardHomeClient from "./DashboardHomeClient"

function DashboardHomeFallback() {
  return (
    <main className="app-page min-h-screen animate-pulse xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-hidden">
      <div className="h-[52px] border-b border-border bg-surface/60 md:h-[57px]" />
      <div className="app-shell mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-6 px-4 py-4 lg:flex-row lg:px-6 xl:mx-0 xl:max-w-none xl:px-0 xl:py-0">
        <div className="hidden h-[70vh] max-h-[640px] w-full max-w-[240px] rounded-xl bg-surface-muted/90 lg:block" />
        <div className="min-h-[50vh] flex-1 rounded-lg bg-surface-muted/70 xl:min-h-0" />
        <div className="hidden w-[312px] bg-surface-muted/50 xl:block" />
      </div>
    </main>
  )
}

/**
 * Pre-resolves the user's primary-resume status server-side so the client doesn't have to
 * wait for `/api/auth/session` → `/api/resume` round-trips before it knows whether to
 * request match scores. Eliminates the double-fetch on refresh.
 */
async function getInitialPrimaryResumeReady() {
  const session = await getSessionUser()
  if (!session?.sub) return false
  try {
    const result = await getPostgresPool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM resumes
         WHERE user_id = $1
           AND is_primary = true
           AND parse_status = 'complete'
       ) AS exists`,
      [session.sub]
    )
    return Boolean(result.rows[0]?.exists)
  } catch {
    return false
  }
}

export default async function DashboardPage() {
  const initialPrimaryResumeReady = await getInitialPrimaryResumeReady()
  return (
    <Suspense fallback={<DashboardHomeFallback />}>
      <DashboardHomeClient initialPrimaryResumeReady={initialPrimaryResumeReady} />
    </Suspense>
  )
}
