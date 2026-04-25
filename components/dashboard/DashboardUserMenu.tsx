"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, CreditCard, LogOut, UserRound } from "lucide-react"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { cn } from "@/lib/utils"

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Hireoven User"
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function firstName(fullName?: string | null, email?: string | null) {
  const fromName = fullName?.trim().split(/\s+/)[0]
  if (fromName) return fromName
  const local = email?.trim().split("@")[0]
  return local || "Account"
}

export default function DashboardUserMenu() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { user, profile, isLoading: authLoading, signOut } = useAuth()
  const { isPro } = useSubscription()

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 max-w-[220px] items-center gap-2 rounded-full border border-[#D7DCEA] bg-white py-0.5 pl-0.5 pr-2.5 text-[13px] transition-colors",
          "hover:border-[#B9C3DE] hover:bg-[#F6F8FD]"
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
      >
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FBEEDF] text-[11px] font-bold text-brand-navy">
            {getInitials(profile?.full_name, profile?.email)}
          </div>
        )}
        <span className="hidden min-w-0 max-w-[120px] truncate font-medium text-slate-800 sm:inline">
          {authLoading ? "…" : firstName(profile?.full_name, profile?.email ?? user?.email)}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[min(100vw-2rem,18rem)] rounded-2xl border border-[#D7DCEA] bg-white py-2 shadow-[0_24px_58px_-34px_rgba(20,30,70,0.55)]"
          role="menu"
        >
          <div className="border-b border-border px-3 pb-3 pt-1">
            <p className="truncate text-sm font-semibold text-strong">
              {profile?.full_name || (authLoading ? "…" : "Your account")}
            </p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email || user?.email || ""}</p>
          </div>

          <div className="p-1.5">
            <Link
              href="/dashboard/onboarding"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-strong transition-colors hover:bg-cyan-50/65"
              onClick={() => setOpen(false)}
            >
              <UserRound className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
              Profile
            </Link>
            <Link
              href={isPro ? "/dashboard/billing" : "/dashboard/upgrade"}
              role="menuitem"
              className={cn(
                "mt-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors",
                isPro
                  ? "text-strong hover:bg-cyan-50/65"
                  : "bg-brand-tint text-brand-navy hover:bg-brand-tint-strong/80"
              )}
              onClick={() => setOpen(false)}
            >
              <CreditCard className={cn("h-4 w-4", isPro ? "text-muted-foreground" : "text-primary")} strokeWidth={2} />
              {isPro ? "Billing" : "Upgrade"}
            </Link>
            <button
              type="button"
              role="menuitem"
              className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-cyan-50/65 hover:text-strong"
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
