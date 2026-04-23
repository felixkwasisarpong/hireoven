"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from "@/lib/dashboard-nav"
import { cn } from "@/lib/utils"

const NAV_BADGES: Partial<Record<string, string>> = {
  Applications: "12",
  Companies: "128",
}

export default function DashboardSidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-1.5" aria-label="Dashboard">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isDashboardNavActive(pathname, item.href)
        const badge = NAV_BADGES[item.label]

        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "group neo-nav-link",
              active
                ? "neo-nav-link-active"
                : "neo-nav-link-idle"
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] flex-shrink-0 transition-colors duration-200",
                active ? "text-white" : "text-muted-foreground group-hover:text-[#4B53CB]"
              )}
              strokeWidth={active ? 2.35 : 2}
              aria-hidden
            />
            <span className="flex-1 truncate">{item.label}</span>
            {badge && !active && (
              <span className="rounded-full border border-[#D9DEEA] bg-[#F2F5FB] px-2 py-0.5 text-[11px] font-semibold text-[#64729A]">
                {badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
