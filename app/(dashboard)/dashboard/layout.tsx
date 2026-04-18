"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BellRing,
  Bookmark,
  Briefcase,
  Building2,
  FileText,
  Globe2,
  LogOut,
  Scroll,
  UserCircle2,
  Waves,
  Zap,
} from "lucide-react"
import GlobalSearchBar from "@/components/search/GlobalSearchBar"
import NotificationBell from "@/components/notifications/NotificationBell"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { ResumeProvider } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import { cn } from "@/lib/utils"

function PipelineWidget() {
  const [counts, setCounts] = useState<{ active: number; offers: number } | null>(null)

  useEffect(() => {
    fetch("/api/applications/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setCounts({
          active:
            (data.by_status?.phone_screen ?? 0) +
            (data.by_status?.interview ?? 0) +
            (data.by_status?.final_round ?? 0),
          offers: data.by_status?.offer ?? 0,
        })
      })
      .catch(() => {})
  }, [])

  if (!counts || (counts.active === 0 && counts.offers === 0)) return null

  return (
    <Link
      href="/dashboard/applications"
      className="mx-0 mb-2 block rounded-[10px] border border-[#FFD2B8]/80 bg-[#FFF7F2] px-3 py-2.5 transition hover:bg-[#FFF1E8]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A3412]">Pipeline</p>
      <div className="mt-1.5 flex items-center gap-3">
        {counts.active > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-base font-bold text-[#062246]">{counts.active}</span>
            <span className="text-[11px] text-slate-500">active</span>
          </div>
        )}
        {counts.offers > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-base font-bold text-emerald-600">{counts.offers}</span>
            <span className="text-[11px] text-slate-500">offer{counts.offers !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

const NAV_ITEMS = [
  { label: "Feed", href: "/dashboard", icon: Waves },
  { label: "Applications", href: "/dashboard/applications", icon: Briefcase },
  { label: "Companies", href: "/dashboard/companies", icon: Building2 },
  { label: "Resume", href: "/dashboard/resume", icon: FileText },
  { label: "Cover letters", href: "/dashboard/cover-letters", icon: Scroll },
  { label: "Autofill", href: "/dashboard/autofill", icon: Zap },
  { label: "Watchlist", href: "/dashboard/watchlist", icon: Bookmark },
  { label: "Alerts", href: "/dashboard/alerts", icon: BellRing },
  { label: "Profile", href: "/dashboard/onboarding", icon: UserCircle2 },
]

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Hireoven User"
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function DashboardSubpageChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, profile, isLoading: authLoading, signOut } = useAuth()

  return (
    <div className="dashboard-subpage min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1680px] items-center gap-4 px-4 py-3 lg:grid-cols-[252px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[252px_minmax(0,1fr)_280px]">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center rounded-[14px] bg-white px-3 py-2 shadow-[0_10px_26px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 transition hover:ring-[#FFD2B8]"
            aria-label="Hireoven dashboard home"
          >
            <HireovenLogo className="h-12 w-auto max-w-[190px]" priority />
          </Link>
          <div className="min-w-0">
            <GlobalSearchBar />
          </div>
          <div className="hidden justify-end xl:flex">
            <NotificationBell userId={user?.id} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1680px] px-4 py-4 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="soft-scrollbar hidden rounded-[20px] border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="flex h-full flex-col">
              <nav className="space-y-0.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active =
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)

                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-all duration-100",
                        active
                          ? "bg-[#062246] text-white shadow-[0_4px_12px_rgba(6,34,70,0.2)]"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <Icon className={cn("h-[15px] w-[15px] flex-shrink-0", active ? "text-white/90" : "text-slate-400")} />
                      {item.label}
                    </Link>
                  )
                })}

                <div className="pt-2">
                  <Link
                    href="/dashboard/international"
                    className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-slate-600 transition-all duration-100 hover:bg-[#FFF1E8] hover:text-[#9A3412]"
                  >
                    <Globe2 className="h-[15px] w-[15px] flex-shrink-0 text-[#FF5C18]" />
                    <span className="flex items-center gap-1.5">
                      International
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                    </span>
                  </Link>
                </div>
              </nav>

              <div className="mt-auto pt-4">
                <PipelineWidget />
                <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/80 p-3">
                  <div className="flex items-center gap-2.5">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatar_url}
                        alt={profile.full_name ?? "User avatar"}
                        className="h-9 w-9 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FFF1E8] text-xs font-bold text-[#062246]">
                        {getInitials(profile?.full_name, profile?.email)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-gray-900 leading-tight">
                        {profile?.full_name || (authLoading ? "…" : "Your profile")}
                      </p>
                      <p className="truncate text-[11px] text-slate-400 mt-0.5">
                        {profile?.email || user?.email || "Signed in"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <div className="dashboard-subpage-content min-w-0">{children}</div>
        </div>
      </div>
    </div>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMainFeed = pathname === "/dashboard"

  if (isMainFeed) {
    return <>{children}</>
  }

  return <DashboardSubpageChrome>{children}</DashboardSubpageChrome>
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ResumeProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </ResumeProvider>
  )
}
