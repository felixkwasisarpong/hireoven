"use client"

import Link from "next/link"
import { ChevronRight, Crown } from "lucide-react"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { cn } from "@/lib/utils"

/** Set NEXT_PUBLIC_HIREOVEN_SITE_PREVIEW=1 on demo / preview deploys to hide billing CTAs. */
function isSitePreviewMode() {
  return process.env.NEXT_PUBLIC_HIREOVEN_SITE_PREVIEW === "1"
}

export default function DashboardSidebarPremiumCard({
  variant = "light",
}: {
  variant?: "light" | "dark"
} = {}) {
  const { isPro } = useSubscription()

  if (isPro || isSitePreviewMode()) return null

  return (
    <div
      className={cn(
        "mt-2 shrink-0 pt-2.5",
        variant === "dark" ? "border-t border-white/10" : "border-t border-border/80"
      )}
    >
      <div className="rounded-xl border border-[#FED7AA]/70 bg-gradient-to-br from-[#FFF7ED] to-[#FFEDD5] p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/90 text-[#F97316] shadow-sm ring-1 ring-[#FED7AA]/50">
            <Crown className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#9A3412]">Unlock all filters</p>
            <p className="mt-1 text-[12px] leading-snug text-[#C2410C]/90">
              Get full access to advanced filters and priority support.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/upgrade"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          Upgrade now
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
