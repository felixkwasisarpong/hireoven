"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Clock3 } from "lucide-react"
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
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell max-w-6xl space-y-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Page header ───────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 px-6 py-7 sm:px-8">
          <div className="pointer-events-none absolute right-[-60px] top-[-60px] h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-80px] left-[20%] h-48 w-48 rounded-full bg-blue-400/15 blur-3xl" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Link
                href="/dashboard/international"
                className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition hover:border-white/20 hover:text-white/80"
              >
                <ArrowLeft className="h-3 w-3" />
                International Hub
              </Link>

              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/10">
                  <Clock3 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-indigo-300">
                    F-1 OPT & STEM OPT
                  </p>
                  <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    OPT Survival Dashboard
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                    Track your authorization timeline, unemployment cushion, and weekly search
                    targets in one focused view.
                  </p>
                </div>
              </div>
            </div>

            <Link
              href="/dashboard/international/h1b-explorer"
              className="inline-flex items-center gap-2 self-start rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white/80 transition hover:border-white/25 hover:bg-white/15 sm:self-auto"
            >
              LCA Explorer →
            </Link>
          </div>
        </div>

        {/* ── Dashboard content ─────────────────────────────── */}
        {isLoading ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              {[220, 180, 260].map((h) => (
                <div key={h} className="surface-card animate-pulse rounded-2xl" style={{ height: h }} />
              ))}
            </div>
            <div className="space-y-4">
              {[160, 140, 280].map((h) => (
                <div key={h} className="surface-card animate-pulse rounded-2xl" style={{ height: h }} />
              ))}
            </div>
          </div>
        ) : (
          <OPTDashboard profile={resolvedProfile} />
        )}

        <div aria-hidden className="h-[clamp(2rem,5vh,4rem)] shrink-0" />
      </div>
    </main>
  )
}
