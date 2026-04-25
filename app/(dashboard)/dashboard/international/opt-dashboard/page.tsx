"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plane } from "lucide-react"
import OPTDashboard from "@/components/immigration/OPTDashboard"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import { useAuth } from "@/lib/hooks/useAuth"
import type { Profile } from "@/types"

export default function OPTDashboardPage() {
  const { profile, isLoading } = useAuth()
  const [resolvedProfile, setResolvedProfile] = useState<Profile | null>(null)

  useEffect(() => {
    if (!isLoading) setResolvedProfile(profile)
  }, [profile, isLoading])

  return (
    <main className="app-page">
      <div className="app-shell max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <DashboardPageHeader
          kicker="International Dashboard"
          title="OPT Survival Dashboard"
          description="Track your authorization timeline, monitor unemployment days, and focus your job search on what matters most before time runs short."
          backHref="/dashboard/international"
          backLabel="Back to International Hub"
          meta={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--accent-soft-border))] bg-[hsl(var(--accent))]/8 px-3 py-1 text-[11.5px] font-semibold text-[hsl(var(--accent))]">
              <Plane className="h-3 w-3" aria-hidden />
              F-1 OPT &amp; STEM OPT
            </span>
          }
          actions={
            <Link
              href="/dashboard/international/h1b-explorer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-[12.5px] font-medium text-strong transition hover:bg-surface-muted"
            >
              LCA Explorer →
            </Link>
          }
        />

        {isLoading ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              {[220, 180, 260].map((h) => (
                <div
                  key={h}
                  className="surface-card animate-pulse rounded-2xl"
                  style={{ height: h }}
                />
              ))}
            </div>
            <div className="space-y-5">
              {[160, 140, 280].map((h) => (
                <div
                  key={h}
                  className="surface-card animate-pulse rounded-2xl"
                  style={{ height: h }}
                />
              ))}
            </div>
          </div>
        ) : (
          <OPTDashboard profile={resolvedProfile} />
        )}
      </div>
    </main>
  )
}
