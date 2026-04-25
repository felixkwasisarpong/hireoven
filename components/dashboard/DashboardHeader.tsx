"use client"

import Link from "next/link"
import { MessageSquare } from "lucide-react"
import DashboardFeedSearch from "@/components/dashboard/DashboardFeedSearch"
import DashboardUserMenu from "@/components/dashboard/DashboardUserMenu"
import NotificationBell from "@/components/notifications/NotificationBell"
import { useAuth } from "@/lib/hooks/useAuth"

/**
 * Header for all `/dashboard/*` routes. The logo lives in the left rail, so the header
 * is just: search pill + bell + messages + user menu — flat white, slate borders.
 */
export default function DashboardHeader() {
  const { user } = useAuth()

  return (
    <header className="dashboard-feed-skin sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <DashboardFeedSearch />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell
            userId={user?.id}
            badgeVariant="product"
            buttonClassName="h-10 w-10 border-0 bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          />
          <Link
            href="/dashboard/notifications"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Activity and messages"
          >
            <MessageSquare className="h-4 w-4" />
          </Link>
          <DashboardUserMenu />
        </div>
      </div>
    </header>
  )
}
