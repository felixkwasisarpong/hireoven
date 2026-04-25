"use client"

import Link from "next/link"
import { Plane } from "lucide-react"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import HireovenLogo from "@/components/ui/HireovenLogo"

/**
 * Left rail for dashboard subpages. Mirrors the main feed sidebar exactly so
 * the chrome (logo + nav + sponsorship card) is consistent across pages.
 */
export default function DashboardSubpageSidebar() {
  return (
    <aside className="dashboard-feed-skin flex w-full flex-col gap-4 border-b border-slate-200 bg-white p-4 xl:sticky xl:top-0 xl:h-[100dvh] xl:w-[260px] xl:flex-shrink-0 xl:border-b-0 xl:border-r xl:p-5">
      <div className="pl-0.5">
        <Link
          href="/dashboard"
          className="block rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
        >
          <HireovenLogo className="h-8 w-auto max-w-[160px]" priority />
          <span className="sr-only">Hireoven home</span>
        </Link>
      </div>

      <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <DashboardSidebarNav variant="light" navSkin="feed" />
      </div>

      <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/95 to-teal-50/80 p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 ring-1 ring-emerald-200/80">
            <Plane className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-950">Sponsorship made easy.</p>
            <p className="mt-0.5 text-[11px] leading-snug text-emerald-900/85">
              Find jobs that offer visa sponsorship and work opportunities abroad.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/international"
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg border-2 border-emerald-500 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-50/90"
        >
          Learn more
        </Link>
      </div>
    </aside>
  )
}
