"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Lock } from "lucide-react"
import { useEffect, useState } from "react"
import {
  DASHBOARD_NAV_ITEMS,
  NAV_GROUPS,
  isDashboardNavActive,
  type DashboardNavItem,
} from "@/lib/dashboard-nav"
import { canAccess } from "@/lib/gates"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
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

// ── Single nav item renderer ──────────────────────────────────────────────────

function NavItem({
  item,
  applicationCount,
  variant,
  navSkin,
}: {
  item: DashboardNavItem
  applicationCount?: number
  variant: "light" | "dark"
  navSkin: "default" | "feed"
}) {
  const pathname = usePathname()
  const { plan, isLoading: subLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()

  const Icon = item.icon
  const active = isDashboardNavActive(pathname, item.href)
  const external = isExternalNavHref(item.href)
  const locked = subLoading ? false : item.gate ? !canAccess(plan, item.gate) : false
  const feedSkin = navSkin === "feed" && variant === "light"

  const badge =
    item.label === "Applications" && !feedSkin
      ? formatNavBadge(applicationCount ?? 0)
      : undefined

  const linkClass = feedSkin
    ? cn(
        "group relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors",
        locked
          ? "cursor-pointer opacity-60 hover:opacity-80"
          : active
            ? "bg-sky-50 font-semibold text-[#2563EB]"
            : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )
    : cn(
        "group neo-nav-link",
        locked
          ? "cursor-pointer opacity-55 hover:opacity-75"
          : active
            ? "neo-nav-link-active"
            : "neo-nav-link-idle"
      )

  const iconClass = feedSkin
    ? cn(
        "h-[18px] w-[18px] flex-shrink-0 transition-colors duration-200",
        locked
          ? "text-slate-400"
          : active
            ? "text-[#2563EB]"
            : "text-slate-500 group-hover:text-[#2563EB]"
      )
    : cn(
        "h-4 w-4 flex-shrink-0 transition-colors duration-200",
        locked
          ? "text-muted-foreground/60"
          : active
            ? "text-white"
            : variant === "dark"
              ? "text-slate-400 group-hover:text-primary"
              : "text-muted-foreground group-hover:text-primary"
      )

  if (subLoading && item.gate) {
    return (
      <div
        className={cn(
          feedSkin
            ? "flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2"
            : "group neo-nav-link neo-nav-link-idle opacity-70"
        )}
        aria-hidden
      >
        <div className={cn("h-4 w-4 animate-pulse rounded bg-slate-200/80")} />
        <div className="h-3 w-24 animate-pulse rounded bg-slate-200/80" />
      </div>
    )
  }

  const inner = (
    <>
      <Icon className={iconClass} strokeWidth={2} aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {locked ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white"
          style={{
            background: "linear-gradient(135deg, #3B82F6 0%, #2563EB 55%, #1D4ED8 100%)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset, 0 0 14px rgba(59,130,246,0.65), 0 1px 3px rgba(37,99,235,0.45)",
            textShadow: "0 1px 1px rgba(10,30,80,0.35)",
          }}
        >
          <Lock className="h-2.5 w-2.5" />
          Pro
        </span>
      ) : badge && !active ? (
        <span className={cn(
          "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          variant === "dark"
            ? "border-slate-600/70 bg-slate-800/70 text-slate-300"
            : "border-[#D9DEEA] bg-[#F2F5FB] text-[#64729A]"
        )}>
          {badge}
        </span>
      ) : null}
    </>
  )

  if (locked) {
    return (
      <button type="button" onClick={() => showUpgrade(item.gate!)}
        className={cn(linkClass, "w-full text-left")}
        title={`Upgrade to unlock ${item.label}`}
      >
        {inner}
      </button>
    )
  }
  if (external) {
    return <a href={item.href} className={linkClass} rel="noopener noreferrer">{inner}</a>
  }
  return <Link href={item.href} className={linkClass}>{inner}</Link>
}

// ── Collapsible group renderer ────────────────────────────────────────────────

function NavGroup({
  groupKey,
  items,
  applicationCount,
  variant,
  navSkin,
}: {
  groupKey: string
  items: DashboardNavItem[]
  applicationCount?: number
  variant: "light" | "dark"
  navSkin: "default" | "feed"
}) {
  const pathname = usePathname()
  const group = NAV_GROUPS[groupKey]
  const GroupIcon = group.icon
  const feedSkin = navSkin === "feed" && variant === "light"

  // Auto-expand when a child page is active
  const hasActive = items.some((i) => isDashboardNavActive(pathname, i.href))
  const [open, setOpen] = useState(hasActive)

  // Re-evaluate if the route changes (e.g. navigate away then back)
  useEffect(() => {
    if (hasActive) setOpen(true)
  }, [hasActive])

  const headerClass = feedSkin
    ? cn(
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
        hasActive
          ? "text-[#2563EB]"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )
    : cn(
        "group neo-nav-link neo-nav-link-idle w-full",
        hasActive && "text-slate-900 font-semibold"
      )

  const iconClass = feedSkin
    ? cn("h-[18px] w-[18px] flex-shrink-0", hasActive ? "text-[#2563EB]" : "text-slate-500 group-hover:text-[#2563EB]")
    : cn("h-4 w-4 flex-shrink-0", variant === "dark" ? "text-slate-400" : "text-muted-foreground group-hover:text-primary")

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={headerClass}>
        <GroupIcon className={iconClass} strokeWidth={2} aria-hidden />
        <span className="flex-1 truncate text-left">{group.label}</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            feedSkin ? "text-slate-400" : "text-muted-foreground/60",
            open && "rotate-90"
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5 pl-4 border-l-2 border-slate-100 ml-[22px]">
          {items.map((item) => (
            <NavItem
              key={item.label}
              item={item}
              applicationCount={applicationCount}
              variant={variant}
              navSkin={navSkin}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main sidebar nav ──────────────────────────────────────────────────────────

export default function DashboardSidebarNav({
  applicationCount,
  variant = "light",
  navSkin = "default",
}: {
  applicationCount?: number
  variant?: "light" | "dark"
  navSkin?: "default" | "feed"
} = {}) {
  const allItems = DASHBOARD_NAV_ITEMS.filter((i) => !i.footer)
  const footerItems = DASHBOARD_NAV_ITEMS.filter((i) => i.footer)

  const topLevel = allItems.filter((i) => !i.group)

  // Build ordered group list (preserves insertion order from NAV_GROUPS)
  const groupKeys = Object.keys(NAV_GROUPS)
  const grouped = groupKeys.map((key) => ({
    key,
    items: allItems.filter((i) => i.group === key),
  })).filter((g) => g.items.length > 0)

  const sharedProps = { applicationCount, variant, navSkin }

  return (
    <nav className="flex h-full min-h-full flex-col" aria-label="Dashboard">
      <div className="space-y-1">
        {topLevel.map((item) => (
          <NavItem key={item.label} item={item} {...sharedProps} />
        ))}

        {grouped.map(({ key, items }) => (
          <NavGroup key={key} groupKey={key} items={items} {...sharedProps} />
        ))}
      </div>

      {footerItems.length > 0 && (
        <div className="mt-auto space-y-1 border-t border-slate-200/80 pt-3">
          {footerItems.map((item) => (
            <NavItem key={item.label} item={item} {...sharedProps} />
          ))}
        </div>
      )}
    </nav>
  )
}
