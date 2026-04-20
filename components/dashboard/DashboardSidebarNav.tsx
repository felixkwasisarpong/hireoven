"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from "@/lib/dashboard-nav"
import { cn } from "@/lib/utils"

export default function DashboardSidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-1" aria-label="Dashboard">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isDashboardNavActive(pathname, item.href)

        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold tracking-tight transition-all duration-150",
              active
                ? "bg-brand-navy text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-muted-foreground hover:bg-surface-alt hover:text-strong"
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] flex-shrink-0 transition-colors",
                active ? "text-white" : "text-muted-foreground group-hover:text-strong"
              )}
              strokeWidth={active ? 2.35 : 2}
              aria-hidden
            />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
