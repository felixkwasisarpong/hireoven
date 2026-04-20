"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BellRing,
  Briefcase,
  Building2,
  Database,
  LayoutDashboard,
  Radar,
  Settings,
  Users,
  Waves,
  ClipboardList,
  Megaphone,
} from "lucide-react"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/waitlist", label: "Waitlist", icon: ClipboardList },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/admin/crawl", label: "Crawl monitor", icon: Radar },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/h1b", label: "H1B data", icon: Database },
  { href: "/admin/alerts", label: "Alerts log", icon: BellRing },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone },
  { href: "/admin/settings", label: "Settings", icon: Settings },
]

/** Pinned below the scrollable nav on large screens — import from admin layout. */
export function AdminSidebarRealtimeTip() {
  return (
    <div className="admin-muted-surface p-4 text-sm text-gray-400">
      <div className="mb-2 flex items-center gap-2 text-white">
        <Waves className="h-4 w-4" />
        Realtime ops
      </div>
      Keep an eye on crawls, fresh jobs, and alert delivery in one place.
    </div>
  )
}

export default function AdminSidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-2" aria-label="Admin">
      {LINKS.map((link) => {
        const active =
          link.href === "/admin" ? pathname === link.href : pathname.startsWith(link.href)
        const Icon = link.icon
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-medium transition-all duration-150",
              active
                ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-gray-400 hover:bg-white/5 hover:text-white"
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition",
                active
                  ? "border-white/10 bg-white/10 text-white"
                  : "border-white/5 bg-white/[0.03] text-gray-400 group-hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
