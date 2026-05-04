"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Lock } from "lucide-react"
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from "@/lib/dashboard-nav"
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

export default function DashboardSidebarNav({
  applicationCount,
  variant = "light",
  navSkin = "default",
}: {
  applicationCount?: number
  variant?: "light" | "dark"
  navSkin?: "default" | "feed"
} = {}) {
  const pathname = usePathname()
  const { plan } = useSubscription()
  const { showUpgrade } = useUpgradeModal()
  const feedSkin = navSkin === "feed" && variant === "light"

  function renderItem(item: typeof DASHBOARD_NAV_ITEMS[number]) {
    const Icon = item.icon
    const active = isDashboardNavActive(pathname, item.href)
    const external = isExternalNavHref(item.href)

    // Gate check — only meaningful once the subscription has loaded (plan !== undefined)
    const locked = item.gate ? !canAccess(plan, item.gate) : false

    const badge =
      item.label === "Applications" && !feedSkin
        ? formatNavBadge(applicationCount ?? 0)
        : undefined

    // ── Shared class builders ──────────────────────────────────────────────
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

    // ── Inner content ──────────────────────────────────────────────────────
    const inner = (
      <>
        <Icon className={iconClass} strokeWidth={2} aria-hidden />
        <span className="flex-1 truncate">{item.label}</span>

        {locked ? (
          // Coloured "Pro" chip so it's unmistakably locked
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white"
            style={{ background: "linear-gradient(135deg, #FF5C18, #FF9A3C)" }}>
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

    // ── Locked item — button that opens upgrade modal ──────────────────────
    if (locked) {
      return (
        <button
          key={item.label}
          type="button"
          onClick={() => showUpgrade(item.gate!)}
          className={cn(linkClass, "w-full text-left")}
          title={`Upgrade to unlock ${item.label}`}
        >
          {inner}
        </button>
      )
    }

    // ── External link ──────────────────────────────────────────────────────
    if (external) {
      return (
        <a key={item.label} href={item.href} className={linkClass} rel="noopener noreferrer">
          {inner}
        </a>
      )
    }

    // ── Regular nav link ───────────────────────────────────────────────────
    return (
      <Link key={item.label} href={item.href} className={linkClass}>
        {inner}
      </Link>
    )
  }

  const primary = DASHBOARD_NAV_ITEMS.filter((i) => !i.footer)
  const footer  = DASHBOARD_NAV_ITEMS.filter((i) => i.footer)

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
