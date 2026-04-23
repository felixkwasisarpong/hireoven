"use client"

import Link from "next/link"
import { Sun } from "lucide-react"
import GlobalSearchBar from "@/components/search/GlobalSearchBar"
import DashboardUserMenu from "@/components/dashboard/DashboardUserMenu"
import NotificationBell from "@/components/notifications/NotificationBell"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { useAuth } from "@/lib/hooks/useAuth"

export default function DashboardHeader() {
  const { user } = useAuth()

  return (
    <header className="dash-header-bar relative">
      <div className="mx-auto flex max-w-[1720px] flex-col gap-3 px-3 py-3 md:flex-row md:items-center md:gap-4 lg:px-4 xl:mx-0 xl:grid xl:max-w-none xl:grid-cols-[252px_minmax(0,1fr)_220px] xl:items-center xl:gap-0 xl:px-0">
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 md:w-[220px] md:justify-start lg:w-[240px] xl:w-auto xl:px-4">
          <Link
            href="/dashboard"
            className="flex min-w-0 shrink-0 items-center rounded-xl border border-transparent px-1 py-0.5 transition-all hover:border-border hover:bg-white/70"
            aria-label="Hireoven dashboard home"
          >
            <HireovenLogo className="h-10 w-auto max-w-[178px]" priority />
          </Link>
        </div>

        <div className="min-w-0 flex-1 xl:px-8">
          <GlobalSearchBar />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 md:gap-2.5 xl:px-4">
          <NotificationBell userId={user?.id} />
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#D7DCEA] bg-white text-[#556186] transition-colors hover:border-[#B9C3DE] hover:bg-[#F6F8FD]"
            aria-label="Theme"
          >
            <Sun className="h-4.5 w-4.5" />
          </button>
          <DashboardUserMenu />
        </div>
      </div>
    </header>
  )
}
