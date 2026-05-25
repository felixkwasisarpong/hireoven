"use client"

import { Menu } from "lucide-react"
import { usePathname } from "next/navigation"
import DashboardFeedSearch from "@/components/dashboard/DashboardFeedSearch"
import DashboardUserMenu from "@/components/dashboard/DashboardUserMenu"
import CreditsDropdown from "@/components/dashboard/CreditsDropdown"
import { useDashboardMobileNav } from "@/components/dashboard/DashboardMobileNav"
import NotificationBell from "@/components/notifications/NotificationBell"
import { useAuth } from "@/lib/hooks/useAuth"

/**
 * Header for all `/dashboard/*` routes. The logo lives in the left rail, so the header
 * is just: search pill + bell + user menu — flat white, slate borders.
 * On the Scout page the search pill is hidden — Scout has its own command bar.
 */
export default function DashboardHeader() {
  const { user } = useAuth()
  const { toggle } = useDashboardMobileNav()
  const pathname = usePathname()
  const isScoutPage = pathname.startsWith("/dashboard/scout")

  return (
    <header className="dashboard-feed-skin sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 xl:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          {!isScoutPage && <DashboardFeedSearch />}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <CreditsDropdown />
          <NotificationBell
            userId={user?.id}
            badgeVariant="product"
            buttonClassName="h-10 w-10 border-0 bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          />
          <DashboardUserMenu />
        </div>
      </div>
    </header>
  )
}
