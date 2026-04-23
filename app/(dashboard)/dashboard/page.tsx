import { Suspense } from "react"
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
 * Server Component wrapper so `useSearchParams` inside the client child is bounded by
 * a real Suspense boundary (required by Next.js App Router — client-only page + Suspense
 * often still renders a blank tree).
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardHomeFallback />}>
      <DashboardHomeClient />
    </Suspense>
  )
}
