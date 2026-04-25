"use client"

import Link from "next/link"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import HireovenLogo from "@/components/ui/HireovenLogo"

/**
 * Left rail for dashboard subpages. Mirrors the main feed sidebar exactly so
 * the chrome (logo + nav) is consistent across pages.
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
    </aside>
  )
}
