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
} from "lucide-react"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/admin/crawl", label: "Crawl monitor", icon: Radar },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/h1b", label: "H1B data", icon: Database },
  { href: "/admin/alerts", label: "Alerts log", icon: BellRing },
  { href: "/admin/settings", label: "Settings", icon: Settings },
]

export default function AdminSidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-2">
      {LINKS.map((link) => {
        const active =
          link.href === "/admin" ? pathname === link.href : pathname.startsWith(link.href)
        const Icon = link.icon
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition",
              active
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icon className="h-4 w-4" />
            {link.label}
          </Link>
        )
      })}
      <div className="pt-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
          <div className="mb-2 flex items-center gap-2 text-white">
            <Waves className="h-4 w-4" />
            Realtime ops
          </div>
          Keep an eye on crawls, fresh jobs, and alert delivery in one place.
        </div>
      </div>
    </nav>
  )
}
