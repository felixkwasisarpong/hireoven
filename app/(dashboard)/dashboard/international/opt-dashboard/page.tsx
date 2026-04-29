"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Plane } from "lucide-react"
import OPTDashboard from "@/components/immigration/OPTDashboard"
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
      <div className="app-shell max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <section className="surface-card overflow-hidden rounded-2xl p-0">
          <div className="relative overflow-hidden border border-border/60 bg-[linear-gradient(135deg,rgba(59,130,246,0.09)_0%,rgba(99,102,241,0.07)_35%,rgba(16,185,129,0.07)_100%)] px-5 py-5 sm:px-6 sm:py-6">
            <div className="pointer-events-none absolute right-[-90px] top-[-110px] h-60 w-60 rounded-full bg-blue-200/30 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link
                  href="/dashboard/international"
                  className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white/80 px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition hover:bg-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back to International Hub
                </Link>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
                    <Plane className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">
                      F-1 OPT & STEM OPT
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.85rem]">
                      OPT Survival Dashboard
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      Track your authorization timeline, unemployment cushion, and weekly search targets in one focused view.
                    </p>
                  </div>
                </div>
              </div>
              <Link
                href="/dashboard/international/h1b-explorer"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-white/90 px-4 text-[12.5px] font-medium text-slate-700 shadow-sm transition hover:bg-white"
              >
                LCA Explorer
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              {[220, 180, 260].map((h) => (
                <div
                  key={h}
                  className="surface-card animate-pulse rounded-2xl"
                  style={{ height: h }}
                />
              ))}
            </div>
            <div className="space-y-4">
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
