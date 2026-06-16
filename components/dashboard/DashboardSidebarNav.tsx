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
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug ? `nav-${slug}` : undefined
}

// ── Feed-skin nav item ────────────────────────────────────────────────────────

function FeedNavItem({
  item,
  applicationCount,
  grouped = false,
}: {
  item: DashboardNavItem
  applicationCount?: number
  grouped?: boolean
}) {
  const pathname = usePathname()
  const { plan, isLoading: subLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()
  const { open: openFeedback } = useFeedbackModal()

  const Icon = item.icon
  const active = isDashboardNavActive(pathname, item.href, item.exact)
  const external = isExternalNavHref(item.href)
  const locked = subLoading ? false : item.gate ? !canAccess(plan, item.gate) : false
  const requiredPlan = item.gate ? requiredPlanFor(item.gate) : null
  const lockLabel = requiredPlan ? PLAN_NAMES[requiredPlan] : "Pro"
  const tourId = navTourId(item.label)

  const badge = item.label === "Applications" ? formatNavBadge(applicationCount ?? 0) : undefined

  const cls = cn(
    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 outline-none transition-all duration-150",
    "focus-visible:ring-2 focus-visible:ring-orange-200",
    grouped ? "py-2" : "py-2",
    locked
      ? "cursor-pointer opacity-55"
      : active
        ? "bg-orange-50 text-orange-700"
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
  )

  const inner = (
    <>
      {/* Icon */}
      <Icon
        className={cn(
          "h-[15px] w-[15px] shrink-0 transition-colors duration-150",
          active
            ? "text-orange-500"
            : "text-slate-400 group-hover:text-slate-600"
        )}
        strokeWidth={active ? 2.25 : 1.9}
        aria-hidden
      />

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn(
          "truncate text-[13px] leading-[1.35]",
          active ? "font-semibold" : "font-medium"
        )}>
          {item.label}
        </span>
        {item.subtitle && (
          <span className={cn(
            "truncate text-[11px] leading-[1.3] font-normal",
            active ? "text-orange-500/70" : "text-slate-400"
          )}>
            {item.subtitle}
          </span>
        )}
      </span>

      {/* Trailing: lock badge or count badge */}
      {locked ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white"
          style={{
            background: "linear-gradient(135deg,#3B82F6 0%,#2563EB 55%,#1D4ED8 100%)",
            boxShadow: "0 0 0 1px rgba(255,255,255,.25) inset,0 0 14px rgba(59,130,246,.65),0 1px 3px rgba(37,99,235,.45)",
          }}
        >
          <Lock className="h-2.5 w-2.5" />
          {lockLabel}
        </span>
      ) : badge && !active ? (
        <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {badge}
        </span>
      ) : null}
    </>
  )

  if (locked) return (
    <button type="button" onClick={() => showUpgrade(item.gate!)} className={cls} title={`Upgrade to ${lockLabel}`} data-tour={tourId}>{inner}</button>
  )
  if (item.action === "feedback") return (
    <button type="button" onClick={openFeedback} className={cls} data-tour={tourId}>{inner}</button>
  )
  if (external) return (
    <a href={item.href} className={cls} rel="noopener noreferrer" data-tour={tourId}>{inner}</a>
  )
  return <Link href={item.href} className={cls} data-tour={tourId}>{inner}</Link>
}

// ── Feed-skin group ───────────────────────────────────────────────────────────

function FeedNavGroup({
  groupKey,
  items,
  applicationCount,
}: {
  groupKey: string
  items: DashboardNavItem[]
  applicationCount?: number
}) {
  const pathname = usePathname()
  const group = NAV_GROUPS[groupKey]
  const GroupIcon = group.icon

  const hasActive = items.some((i) => isDashboardNavActive(pathname, i.href))
  const [open, setOpen] = useState(hasActive)

  useEffect(() => { if (hasActive) setOpen(true) }, [hasActive])
  useEffect(() => {
    const fn = () => setOpen(true)
    window.addEventListener(TOUR_OPEN_GROUPS_EVENT, fn)
    return () => window.removeEventListener(TOUR_OPEN_GROUPS_EVENT, fn)
  }, [])

  return (
    <div>
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150",
          hasActive
            ? "text-slate-800"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        )}
      >
        <GroupIcon
          className={cn(
            "h-[15px] w-[15px] shrink-0 transition-colors duration-150",
            hasActive ? "text-slate-600" : "text-slate-400 group-hover:text-slate-500"
          )}
          strokeWidth={hasActive ? 2 : 1.9}
          aria-hidden
        />
        <span className={cn(
          "flex-1 truncate text-left text-[13px]",
          hasActive ? "font-semibold text-slate-800" : "font-medium"
        )}>
          {group.label}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open ? "rotate-90 text-slate-400" : "text-slate-300"
          )}
        />
      </button>

      {/* Children */}
      {open && (
        <div className="mt-0.5 space-y-0.5 px-1">
          {items.map((item) => (
            <FeedNavItem key={item.label} item={item} applicationCount={applicationCount} grouped />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Legacy default/dark skin (unchanged) ─────────────────────────────────────

function DefaultNavItem({
  item,
  applicationCount,
  variant,
}: {
  item: DashboardNavItem
  applicationCount?: number
  variant: "light" | "dark"
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
  const tourId = navTourId(item.label)
  const hasSubtitle = Boolean(item.subtitle)
  const badge = item.label === "Applications" ? formatNavBadge(applicationCount ?? 0) : undefined

  const linkClass = cn(
    "group neo-nav-link",
    locked ? "cursor-pointer opacity-55 hover:opacity-75" : active ? "neo-nav-link-active" : "neo-nav-link-idle"
  )

  const iconClass = cn(
    "h-[15px] w-[15px] flex-shrink-0 transition-colors duration-200",
    locked ? "text-slate-400" : active ? "text-white" : variant === "dark" ? "text-slate-400 group-hover:text-slate-200" : "text-slate-500 group-hover:text-slate-700"
  )

  if (subLoading && item.gate) return (
    <div className="group neo-nav-link neo-nav-link-idle opacity-70" aria-hidden>
      <div className="h-4 w-4 animate-pulse rounded bg-slate-100" />
      <div className="h-3 w-24 animate-pulse rounded bg-slate-200/80" />
    </div>
  )

  const iconEl = hasSubtitle ? (
    <span className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
      locked ? "bg-slate-100/80" : active ? "bg-white/20" : variant === "dark" ? "bg-slate-700/60 group-hover:bg-slate-600/60" : "bg-slate-100 group-hover:bg-slate-200/80"
    )}>
      <Icon className={iconClass} strokeWidth={1.75} aria-hidden />
    </span>
  ) : (
    <Icon className={cn(iconClass, active && !locked && "fill-current")} strokeWidth={2} aria-hidden />
  )

  const inner = (
    <>
      {iconEl}
      <span className="flex-1 min-w-0">
        <span className="block truncate">{item.label}</span>
        {item.subtitle && (
          <span className={cn(
            "mt-0.5 block truncate text-[11px] font-normal leading-[1.2]",
            active ? "text-white/70" : variant === "dark" ? "text-slate-500" : "text-slate-400"
          )}>
            {item.subtitle}
          </span>
        )}
      </span>
      {locked ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white"
          style={{ background: "linear-gradient(135deg,#3B82F6 0%,#2563EB 55%,#1D4ED8 100%)", boxShadow: "0 0 0 1px rgba(255,255,255,.25) inset" }}>
          <Lock className="h-2.5 w-2.5" />{lockLabel}
        </span>
      ) : badge && !active ? (
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", variant === "dark" ? "border-slate-600/70 bg-slate-800/70 text-slate-300" : "border-[#D9DEEA] bg-[#F2F5FB] text-[#64729A]")}>{badge}</span>
      ) : null}
    </>
  )

  if (locked) return <button type="button" onClick={() => showUpgrade(item.gate!)} className={cn(linkClass, "w-full text-left")} data-tour={tourId}>{inner}</button>
  if (item.action === "feedback") return <button type="button" onClick={openFeedback} className={cn(linkClass, "w-full text-left")} data-tour={tourId}>{inner}</button>
  if (external) return <a href={item.href} className={linkClass} rel="noopener noreferrer" data-tour={tourId}>{inner}</a>
  return <Link href={item.href} className={linkClass} data-tour={tourId}>{inner}</Link>
}

function DefaultNavGroup({
  groupKey,
  items,
  applicationCount,
  variant,
}: {
  groupKey: string
  items: DashboardNavItem[]
  applicationCount?: number
  variant: "light" | "dark"
}) {
  const pathname = usePathname()
  const group = NAV_GROUPS[groupKey]

  const hasActive = items.some((i) => isDashboardNavActive(pathname, i.href))
  const [open, setOpen] = useState(hasActive)

  useEffect(() => { if (hasActive) setOpen(true) }, [hasActive])
  useEffect(() => {
    const fn = () => setOpen(true)
    window.addEventListener(TOUR_OPEN_GROUPS_EVENT, fn)
    return () => window.removeEventListener(TOUR_OPEN_GROUPS_EVENT, fn)
  }, [])

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        hasActive ? "text-slate-700" : "text-slate-400 hover:text-slate-600"
      )}>
        <span className="flex-1 truncate text-left text-[10.5px] font-bold uppercase tracking-[0.1em]">{group.label}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform duration-200", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {items.map((item) => (
            <DefaultNavItem key={item.label} item={item} applicationCount={applicationCount} variant={variant} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function DashboardSidebarNav({
  applicationCount,
  variant = "light",
  navSkin = "default",
}: {
  applicationCount?: number
  variant?: "light" | "dark"
  navSkin?: "default" | "feed"
} = {}) {
  const feedSkin = navSkin === "feed" && variant === "light"

  const allItems = DASHBOARD_NAV_ITEMS.filter((i) => !i.footer)
  const footerItems = DASHBOARD_NAV_ITEMS.filter((i) => i.footer)
  const topLevel = allItems.filter((i) => !i.group)
  const groupKeys = Object.keys(NAV_GROUPS)
  const grouped = groupKeys.map((key) => ({
    key,
    items: allItems.filter((i) => i.group === key),
  })).filter((g) => g.items.length > 0)

  if (feedSkin) {
    return (
      <nav className="flex h-full min-h-full flex-col" aria-label="Dashboard" data-tour="dashboard-sidebar">
        <div className="space-y-0.5">
          {topLevel.map((item) => (
            <FeedNavItem key={item.label} item={item} applicationCount={applicationCount} />
          ))}
          <div className="pt-1" />
          {grouped.map(({ key, items }) => (
            <FeedNavGroup key={key} groupKey={key} items={items} applicationCount={applicationCount} />
          ))}
        </div>
        {footerItems.length > 0 && (
          <div className="mt-auto space-y-0.5 border-t border-slate-100 pt-3">
            {footerItems.map((item) => (
              <FeedNavItem key={item.label} item={item} applicationCount={applicationCount} />
            ))}
          </div>
        )}
      </nav>
    )
  }

  return (
    <nav className="flex h-full min-h-full flex-col" aria-label="Dashboard" data-tour="dashboard-sidebar">
      <div className="space-y-1">
        {topLevel.map((item) => (
          <DefaultNavItem key={item.label} item={item} applicationCount={applicationCount} variant={variant} />
        ))}
        {grouped.map(({ key, items }) => (
          <DefaultNavGroup key={key} groupKey={key} items={items} applicationCount={applicationCount} variant={variant} />
        ))}
      </div>
      {footerItems.length > 0 && (
        <div className="mt-auto space-y-1 border-t border-slate-200/80 pt-3">
          {footerItems.map((item) => (
            <DefaultNavItem key={item.label} item={item} applicationCount={applicationCount} variant={variant} />
          ))}
        </div>
      )}
    </nav>
  )
}
