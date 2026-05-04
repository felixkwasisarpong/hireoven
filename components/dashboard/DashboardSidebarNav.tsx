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

  function renderItem(item: typeof DASHBOARD_NAV_ITEMS[number]) {
    const Icon = item.icon
    const active = isDashboardNavActive(pathname, item.href)
    const badge =
      item.label === "Applications" && !feedSkin
        ? formatNavBadge(applicationCount ?? 0)
        : undefined
    const external = isExternalNavHref(item.href)

    const linkClass = feedSkin
      ? cn(
          "group relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors",
          active
            ? "bg-sky-50 font-semibold text-[#2563EB]"
            : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        )
      : cn("group neo-nav-link", active ? "neo-nav-link-active" : "neo-nav-link-idle")

    const iconClass = feedSkin
      ? cn(
          "h-[18px] w-[18px] flex-shrink-0 transition-colors duration-200",
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

    if (external) {
      return (
        <a key={item.label} href={item.href} className={linkClass} rel="noopener noreferrer">
          {inner}
        </a>
      )
    }
    return (
      <Link key={item.label} href={item.href} className={linkClass}>
        {inner}
      </Link>
    )
  }

  const primary = DASHBOARD_NAV_ITEMS.filter((i) => !i.footer)
  const footer = DASHBOARD_NAV_ITEMS.filter((i) => i.footer)

  return (
    <nav className="flex h-full min-h-full flex-col" aria-label="Dashboard">
      <div className="space-y-1">{primary.map(renderItem)}</div>
      {footer.length > 0 && (
        <div className="mt-auto space-y-1 border-t border-slate-200/80 pt-3">
          {footer.map(renderItem)}
        </div>
      )}
    </nav>
  )
}
