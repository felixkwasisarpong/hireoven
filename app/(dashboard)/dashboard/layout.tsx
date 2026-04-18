"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BellRing,
  Bookmark,
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

const NAV_ITEMS = [
  { label: "Feed", href: "/dashboard", icon: Waves },
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
          <div className="hidden items-center text-xs font-medium uppercase tracking-[0.2em] text-slate-400 lg:flex">
            Job seeker dashboard
          </div>
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
              <div className="px-2 pb-5 pt-2">
                <HireovenLogo className="h-10 w-auto max-w-[152px]" priority />
              </div>

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
