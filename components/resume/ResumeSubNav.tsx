"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Library,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Tab = {
  label: string
  href: string
  icon: React.ElementType
  /** When true, only `href` matches (not child routes). */
  exact?: boolean
}

const TABS: Tab[] = [
  {
    label: "Overview",
    href: "/dashboard/resume",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    label: "Library",
    href: "/dashboard/resume/library",
    icon: Library,
  },
  {
    label: "Studio",
    href: "/dashboard/resume/studio",
    icon: Sparkles,
  },
]

const HIDDEN_PREFIXES = ["/dashboard/resume/analyze"]

function isTabActive(pathname: string, tab: Tab) {
  if (tab.exact) {
    return pathname === tab.href || pathname === `${tab.href}/`
  }
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`)
}

export default function ResumeSubNav() {
  const pathname = usePathname()

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null

  return (
    <div className="border-b border-slate-200/90 bg-white">
      <div className="overflow-x-auto scrollbar-none">
        <nav
          aria-label="Resume sections"
          className="flex items-stretch gap-0 px-4 sm:px-7"
        >
          {TABS.map((tab) => {
            const active = isTabActive(pathname, tab)
            const Icon = tab.icon

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors sm:px-4",
                  active
                    ? "border-orange-600 bg-orange-50/50 text-orange-950"
                    : "border-transparent text-slate-600 hover:bg-slate-50/80 hover:text-slate-900"
                )}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-orange-600 sm:block"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                    active
                      ? "border-orange-200 bg-white text-orange-700"
                      : "border-slate-200/80 bg-slate-50 text-slate-500 group-hover:border-slate-300 group-hover:text-slate-700"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
