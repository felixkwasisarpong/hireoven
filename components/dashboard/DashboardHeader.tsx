"use client"

import Link from "next/link"
import GlobalSearchBar from "@/components/search/GlobalSearchBar"
import DashboardUserMenu from "@/components/dashboard/DashboardUserMenu"
import NotificationBell from "@/components/notifications/NotificationBell"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { useAuth } from "@/lib/hooks/useAuth"

export default function DashboardHeader() {
  const { user } = useAuth()

  return (
    <header className="dash-header-bar">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-4 lg:px-6 xl:mx-0 xl:grid xl:max-w-none xl:grid-cols-[240px_minmax(0,1fr)_312px] xl:items-center xl:gap-0 xl:px-0">
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 md:w-[220px] md:justify-start lg:w-[240px] xl:w-auto xl:px-4">
          <Link
            href="/dashboard"
            className="flex min-w-0 shrink-0 items-center transition-opacity hover:opacity-90"
            aria-label="Hireoven dashboard home"
          >
            <HireovenLogo className="h-11 w-auto max-w-[184px]" priority />
          </Link>
        </div>

        <div className="min-w-0 flex-1 xl:px-6">
          <GlobalSearchBar />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 md:gap-2.5 xl:px-4">
          <NotificationBell userId={user?.id} />
          <DashboardUserMenu />
        </div>
      </div>
    </header>
  )
}
