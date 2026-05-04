"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Bell, Briefcase, ChevronRight, Settings } from "lucide-react"
import {
  isLocalNotification,
  useNotifications,
  type AppNotification,
} from "@/lib/hooks/useNotifications"
import { cn } from "@/lib/utils"
import CompanyLogo from "@/components/ui/CompanyLogo"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(timestamp: string) {
  const diff = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  if (diff < 60) return `${diff}m`
  const h = Math.floor(diff / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function jobTitle(n: AppNotification) {
  if (isLocalNotification(n)) return n.title
  return n.job?.title ?? "New job"
}

function companyName(n: AppNotification) {
  if (isLocalNotification(n)) return n.context?.company ?? null
  return n.job?.company?.name ?? null
}

function jobLocation(n: AppNotification) {
  if (isLocalNotification(n)) return null
  const job = n.job
  if (!job) return null
  if (job.is_remote) return "Remote"
  if (job.is_hybrid && job.location) return `Hybrid · ${job.location}`
  return job.location ?? null
}

function companyDomain(n: AppNotification): string | null {
  if (isLocalNotification(n)) return null
  return n.job?.company?.domain ?? null
}

function companyLogoUrl(n: AppNotification): string | null {
  if (isLocalNotification(n)) return null
  return n.job?.company?.logo_url ?? null
}

function matchScore(n: AppNotification): number | null {
  if (isLocalNotification(n)) {
    const ctx = n.context
    if (typeof ctx?.matchScore === "number") return Math.round(ctx.matchScore)
    return null
  }
  const s = n.job?.match_score?.overall_score
  if (typeof s === "number") return Math.round(s)
  return null
}

function sponsorshipSignal(n: AppNotification): "likely" | "blocked" | null {
  if (isLocalNotification(n)) return null
  if (n.job?.requires_authorization) return "blocked"
  if (n.job?.sponsors_h1b || (n.job?.sponsorship_score ?? 0) >= 70) return "likely"
  return null
}

function targetHref(n: AppNotification): string | null {
  if (isLocalNotification(n)) return n.href
  if (n.job?.id) return `/dashboard?jobId=${n.job.id}`
  if (n.job?.apply_url) return n.job.apply_url
  return "/dashboard"
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function NotifAvatar({ notification }: { notification: AppNotification }) {
  const co = companyName(notification)
  const domain = companyDomain(notification)
  const logoUrl = companyLogoUrl(notification)
  const isLocal = isLocalNotification(notification)

  if (!isLocal && (domain || logoUrl || co)) {
    return (
      <CompanyLogo
        companyName={co ?? ""}
        domain={domain ?? undefined}
        logoUrl={logoUrl ?? undefined}
        className="h-11 w-11 shrink-0 rounded-full ring-1 ring-slate-200"
      />
    )
  }

  // Fallback: Hireoven branded icon for local/system notifications
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ring-slate-200"
      style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}>
      <Briefcase className="h-5 w-5 text-white" />
    </div>
  )
}

// ── Single notification row ───────────────────────────────────────────────────

function NotifRow({
  notification,
  onRead,
}: {
  notification: AppNotification
  onRead: (id: string, clicked?: boolean) => void
}) {
  const unread = !notification.opened_at
  const title = jobTitle(notification)
  const company = companyName(notification)
  const location = jobLocation(notification)
  const score = matchScore(notification)
  const sponsor = sponsorshipSignal(notification)
  const href = targetHref(notification)

  function handleClick() {
    onRead(notification.id, true)
    if (href) window.location.href = href
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
        unread ? "bg-blue-50/40 hover:bg-blue-50/70" : "hover:bg-slate-50"
      )}
    >
      {/* Company logo */}
      <NotifAvatar notification={notification} />

      {/* Text content */}
      <div className="min-w-0 flex-1 pr-2">
        {/* Job title */}
        <p className={cn(
          "text-[13.5px] leading-snug text-slate-900",
          unread ? "font-semibold" : "font-medium"
        )}>
          {title}
        </p>

        {/* Company · Location */}
        {(company || location) && (
          <p className="mt-0.5 text-[12px] text-slate-500 leading-snug">
            {[company, location].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Signals row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {/* Time */}
          <span className="text-[11px] text-slate-400">
            {formatRelative(notification.sent_at)}
          </span>

          {/* Match score */}
          {score !== null && (
            <span className={cn(
              "rounded-full px-2 py-px text-[10.5px] font-semibold",
              score >= 80 ? "bg-emerald-100 text-emerald-700" :
              score >= 65 ? "bg-sky-100 text-sky-700" :
              "bg-amber-100 text-amber-700"
            )}>
              {score}% match
            </span>
          )}

          {/* Sponsorship */}
          {sponsor === "likely" && (
            <span className="rounded-full bg-violet-100 px-2 py-px text-[10.5px] font-semibold text-violet-700">
              H1B likely
            </span>
          )}
          {sponsor === "blocked" && (
            <span className="rounded-full bg-red-100 px-2 py-px text-[10.5px] font-semibold text-red-600">
              No sponsor
            </span>
          )}
        </div>
      </div>

      {/* Right side: unread dot + time */}
      <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
        {unread && (
          <span className="h-2.5 w-2.5 rounded-full bg-[#0A66C2]" />
        )}
      </div>
    </button>
  )
}

// ── Bell button + panel ───────────────────────────────────────────────────────

export default function NotificationBell({
  userId,
  badgeVariant = "red",
  buttonClassName,
}: {
  userId?: string
  badgeVariant?: "red" | "product"
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { notifications, unreadCount, markAllRead, markAsRead } = useNotifications(userId, "all", 15)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  if (!userId) return null

  const badgeLabel = unreadCount <= 0 ? null : unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900",
          open && "border-slate-300 bg-slate-50",
          buttonClassName
        )}
      >
        <Bell className="h-4 w-4" />
        {badgeLabel && (
          <span className={cn(
            "absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white",
            badgeVariant === "product" ? "bg-[#0A66C2]" : "bg-red-500"
          )}>
            {badgeLabel}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_40px_-8px_rgba(15,23,42,0.25)]">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-[15px] font-bold text-slate-900">Notifications</h3>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-[12px] font-semibold text-[#0A66C2] transition hover:underline"
                >
                  Mark all as read
                </button>
              )}
              <Link
                href="/dashboard/notifications"
                onClick={() => setOpen(false)}
                className="text-slate-400 transition hover:text-slate-700"
                title="Notification settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Bell className="mx-auto mb-3 h-8 w-8 text-slate-200" />
                <p className="text-[13px] font-semibold text-slate-600">No notifications yet</p>
                <p className="mt-1 text-[12px] text-slate-400">
                  New job matches and watchlist updates will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotifRow
                  key={n.id}
                  notification={n}
                  onRead={(id, clicked) => {
                    void markAsRead(id, clicked)
                    setOpen(false)
                  }}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3">
              <Link
                href="/dashboard/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1 text-[13px] font-semibold text-[#0A66C2] transition hover:underline"
              >
                View all notifications
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
