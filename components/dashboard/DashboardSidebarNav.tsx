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
import { PLAN_NAMES, canAccess, requiredPlanFor } from "@/lib/gates"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { useFeedbackModal } from "@/lib/context/FeedbackModalContext"
import { cn } from "@/lib/utils"

const TOUR_OPEN_GROUPS_EVENT = "hireoven:product-tour:open-groups"

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

function navTourId(label: string): string | undefined {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug ? `nav-${slug}` : undefined
}

// ── Single nav item renderer ──────────────────────────────────────────────────

function NavItem({
  item,
  applicationCount,
  variant,
  navSkin,
  grouped = false,
}: {
  item: DashboardNavItem
  applicationCount?: number
  variant: "light" | "dark"
  navSkin: "default" | "feed"
  grouped?: boolean
}) {
  const pathname = usePathname()
  const { plan, isLoading: subLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()
  const { open: openFeedback } = useFeedbackModal()

  const Icon = item.icon
  const active = isDashboardNavActive(pathname, item.href)
  const external = isExternalNavHref(item.href)
  const locked = subLoading ? false : item.gate ? !canAccess(plan, item.gate) : false
  const requiredPlan = item.gate ? requiredPlanFor(item.gate) : null
  const lockLabel = requiredPlan ? PLAN_NAMES[requiredPlan] : "Pro"
  const feedSkin = navSkin === "feed" && variant === "light"
  const tourId = navTourId(item.label)
  const hasSubtitle = Boolean(item.subtitle)
  const feedGrouped = feedSkin && grouped

  const badge =
    item.label === "Applications" && !feedSkin
      ? formatNavBadge(applicationCount ?? 0)
      : undefined

  const linkClass = feedSkin
    ? cn(
        "group flex items-center rounded-xl text-[13px] transition-colors duration-150",
        feedGrouped ? "gap-3 px-3 py-2.5" : "gap-3 px-3 py-2",
        locked
          ? "cursor-pointer opacity-60 hover:opacity-80"
          : active
            ? "bg-orange-50 font-semibold text-orange-700"
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
        "h-4 w-4 flex-shrink-0 fill-none transition-colors duration-150",
        locked
          ? "text-slate-400"
          : active
            ? "text-orange-600"
            : "text-slate-400 group-hover:text-slate-700"
      )
    : cn(
        "h-[15px] w-[15px] flex-shrink-0 transition-colors duration-200",
        locked
          ? "text-slate-400"
          : active
            ? "text-white"
            : variant === "dark"
              ? "text-slate-400 group-hover:text-slate-200"
              : "text-slate-500 group-hover:text-slate-700"
      )

  if (subLoading && item.gate) {
    return (
      <div
        className={cn(
          feedSkin
            ? "flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2"
            : "group neo-nav-link neo-nav-link-idle opacity-70"
        )}
        aria-hidden
      >
        <div className="h-4 w-4 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-24 animate-pulse rounded bg-slate-200/80" />
      </div>
    )
  }

  // Icon — flat for feedSkin, boxed for non-feed detail items.
  const iconEl = feedSkin ? (
    <Icon className={iconClass} strokeWidth={1.8} aria-hidden />
  ) : !feedSkin && hasSubtitle ? (
    <span className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
      locked
        ? "bg-slate-100/80"
        : active
          ? "bg-white/20"
          : variant === "dark"
            ? "bg-slate-700/60 group-hover:bg-slate-600/60"
            : "bg-slate-100 group-hover:bg-slate-200/80"
    )}>
      <Icon className={iconClass} strokeWidth={1.75} aria-hidden />
    </span>
  ) : (
    <Icon className={cn(iconClass, !feedSkin && active && !locked && "fill-current")} strokeWidth={2} aria-hidden />
  )

  const inner = (
    <>
      {iconEl}
      <span className="flex-1 min-w-0">
        <span className={cn("block truncate", feedGrouped && "leading-4")}>{item.label}</span>
        {item.subtitle ? (
          <span
            className={cn(
              "mt-0.5 block text-[11px] font-normal leading-[1.2]",
              feedSkin ? "sidebar-nav-subtitle" : "truncate",
              active && !feedSkin
                ? "text-white/70"
                : feedSkin && active
                  ? "text-orange-600/70"
                  : variant === "dark" ? "text-slate-500" : "text-slate-400"
            )}
          >
            {item.subtitle}
          </span>
        ) : null}
      </span>
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
          {lockLabel}
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
        title={`Upgrade to ${lockLabel} to unlock ${item.label}`}
        data-tour={tourId}
      >
        {inner}
      </button>
    )
  }
  if (item.action === "feedback") {
    return (
      <button
        type="button"
        onClick={openFeedback}
        className={cn(linkClass, "w-full text-left")}
        data-tour={tourId}
      >
        {inner}
      </button>
    )
  }
  if (external) {
    return <a href={item.href} className={linkClass} rel="noopener noreferrer" data-tour={tourId}>{inner}</a>
  }
  return <Link href={item.href} className={linkClass} data-tour={tourId}>{inner}</Link>
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

  useEffect(() => {
    function onTourPrep() {
      setOpen(true)
    }
    window.addEventListener(TOUR_OPEN_GROUPS_EVENT, onTourPrep)
    return () => window.removeEventListener(TOUR_OPEN_GROUPS_EVENT, onTourPrep)
  }, [])

  const headerClass = feedSkin
    ? cn(
        "group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors duration-150",
        hasActive
          ? "text-slate-900"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      )
    : cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        hasActive ? "text-slate-700" : "text-slate-400 hover:text-slate-600"
      )

  const headerIconClass = feedSkin
    ? cn("h-4 w-4 flex-shrink-0 fill-none", hasActive ? "text-orange-500" : "text-slate-400 group-hover:text-slate-600")
    : cn("h-3.5 w-3.5 flex-shrink-0", hasActive ? "text-slate-500" : "text-slate-400")

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={headerClass}>
        {feedSkin && <GroupIcon className={headerIconClass} strokeWidth={1.9} aria-hidden />}
        <span className={cn(
          "flex-1 truncate text-left",
          feedSkin
            ? "text-[13px]"
            : "text-[10.5px] font-bold uppercase tracking-[0.1em]"
        )}>
          {group.label}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            feedSkin ? "text-slate-300" : "text-slate-300",
            open && "rotate-90"
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {items.map((item) => (
            <NavItem
              key={item.label}
              item={item}
              applicationCount={applicationCount}
              variant={variant}
              navSkin={navSkin}
              grouped
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
    <nav className="flex h-full min-h-full flex-col" aria-label="Dashboard" data-tour="dashboard-sidebar">
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
