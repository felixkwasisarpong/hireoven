"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from "@/lib/dashboard-nav"
import { cn } from "@/lib/utils"

function formatNavBadge(n: number) {
  if (n <= 0) return undefined
  if (n > 99) return "99+"
  return String(n)
}

function isExternalNavHref(href: string) {
  return (
    href.startsWith("mailto:") ||
    href.startsWith("http://") ||
    href.startsWith("https://")
  )
}

export default function DashboardSidebarNav({
  applicationCount,
  variant = "light",
  navSkin = "default",
}: {
  applicationCount?: number
  /** `dark` = Mosaic-style rail (slate background). */
  variant?: "light" | "dark"
  /** `feed` = light blue active state (main job feed shell). */
  navSkin?: "default" | "feed"
} = {}) {
  const pathname = usePathname()
  const feedSkin = navSkin === "feed" && variant === "light"

  return (
    <nav className="space-y-1" aria-label="Dashboard">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isDashboardNavActive(pathname, item.href)
        const badge =
          item.label === "Applications" && !feedSkin
            ? formatNavBadge(applicationCount ?? 0)
            : undefined
        const external = isExternalNavHref(item.href)

        const linkClass = feedSkin
          ? cn(
              "group relative flex min-h-[34px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
              active
                ? "bg-sky-50 font-semibold text-[#2563EB]"
                : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )
          : cn("group neo-nav-link", active ? "neo-nav-link-active" : "neo-nav-link-idle")

        const iconClass = feedSkin
          ? cn(
              "h-4 w-4 flex-shrink-0 transition-colors duration-200",
              active ? "text-[#2563EB]" : "text-slate-500 group-hover:text-[#2563EB]"
            )
          : cn(
              "h-4 w-4 flex-shrink-0 transition-colors duration-200",
              active
                ? "text-white"
                : variant === "dark"
                  ? "text-slate-400 group-hover:text-primary"
                  : "text-muted-foreground group-hover:text-primary"
            )

        const inner = (
          <>
            <Icon className={iconClass} strokeWidth={2} aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {badge && !active && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  variant === "dark"
                    ? "border-slate-600/70 bg-slate-800/70 text-slate-300"
                    : "border-[#D9DEEA] bg-[#F2F5FB] text-[#64729A]"
                )}
              >
                {badge}
              </span>
            )}
          </>
        )

        const divider =
          feedSkin && item.dividerAbove ? (
            <hr key={`${item.label}-divider`} className="my-2 border-t border-slate-200/80" aria-hidden />
          ) : null

        if (external) {
          return (
            <div key={item.label}>
              {divider}
              <a href={item.href} className={linkClass} rel="noopener noreferrer">
                {inner}
              </a>
            </div>
          )
        }

        return (
          <div key={item.label}>
            {divider}
            <Link href={item.href} className={linkClass}>
              {inner}
            </Link>
          </div>
        )
      })}
    </nav>
  )
}
