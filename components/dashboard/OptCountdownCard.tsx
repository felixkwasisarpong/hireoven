"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Globe2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { VisaStatus } from "@/types"

const MS_PER_DAY = 86_400_000
const DEFAULT_OPT_WINDOW_DAYS = 365

/** Normalize API/profile values (Postgres date strings, ISO timestamps, edge types). */
function coerceOptDateString(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === "string") {
    const t = raw.trim()
    return t.length ? t : null
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  const s = String(raw).trim()
  return s.length ? s : null
}

/** End of calendar day in local time for `YYYY-MM-DD` (matches how users set OPT in forms). */
function endOfLocalCalendarDay(isoOrYmd: string): Date | null {
  const trimmed = isoOrYmd.trim()
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (ymd) {
    const y = Number(ymd[1])
    const m = Number(ymd[2]) - 1
    const d = Number(ymd[3])
    const end = new Date(y, m, d, 23, 59, 59, 999)
    return Number.isNaN(end.getTime()) ? null : end
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  parsed.setHours(23, 59, 59, 999)
  return parsed
}

function optCaption(daysLeft: number) {
  if (daysLeft <= 0) return "Your OPT window has ended—explore other visa paths or roles in your home region."
  if (daysLeft <= 7) return "Act quickly on roles that fit—every application counts now."
  if (daysLeft <= 30) return "Final stretch—prioritize high-fit applications and interviews."
  if (daysLeft <= 90) return "Time to focus: target roles that match your skills and sponsorship needs."
  if (daysLeft <= 180) return "Solid runway—keep building signal with quality applications."
  return "You still have room to be selective."
}

function isOptLikeVisa(status: VisaStatus | null | undefined) {
  return status === "opt" || status === "stem_opt"
}

type Props = {
  /** From `profiles.opt_end_date` (string or rare serialized Date from clients). */
  optEndDate: string | null | undefined
  visaStatus: VisaStatus | null | undefined
}

export default function OptCountdownCard({
  optEndDate,
  visaStatus,
}: Props) {
  const [now, setNow] = useState(() => Date.now())
  const normalizedEnd = coerceOptDateString(optEndDate)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  const hasEnd = Boolean(normalizedEnd)
  const showCta = !hasEnd && isOptLikeVisa(visaStatus)
  if (!hasEnd && !showCta) return null

  if (showCta) {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-semibold text-[#374151]">OPT countdown</p>
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#F97316] text-white shadow-sm">
            <Globe2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-snug text-[#64748B]">
          Add your OPT end date to see a live countdown and timeline.
        </p>
        <Link
          href="/dashboard/international"
          className="mt-3 inline-flex text-xs font-semibold text-[#F97316] hover:underline"
        >
          Update visa profile →
        </Link>
      </div>
    )
  }

  const parsed = endOfLocalCalendarDay(normalizedEnd!)
  if (!parsed) return null

  const daysLeft = Math.ceil((parsed.getTime() - now) / MS_PER_DAY)
  const barPct = Math.min(100, Math.max(4, (Math.max(0, daysLeft) / DEFAULT_OPT_WINDOW_DAYS) * 100))
  const mainLabel = daysLeft <= 0 ? "Ended" : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-[#64748B]">OPT countdown</p>
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#F97316] text-white shadow-sm">
          <Globe2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        </span>
      </div>

      <p
        className={cn(
          "mt-3 text-[32px] font-bold leading-none tracking-tight",
          daysLeft <= 14 && daysLeft > 0 ? "text-[#B45309]" : "text-[#0F172A]"
        )}
      >
        {mainLabel}
        {daysLeft > 0 && <span className="ml-1.5 text-[15px] font-semibold text-[#64748B]">left</span>}
      </p>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F1F5F9]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#6366F1] to-[#7C3AED] transition-[width] duration-500"
          style={{ width: `${barPct}%` }}
        />
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-[#64748B]">{optCaption(daysLeft)}</p>

      <Link
        href="/dashboard/international"
        className="mt-2 inline-flex text-[11px] font-semibold text-[#F97316] hover:underline"
      >
        Visa details →
      </Link>
    </div>
  )
}
