"use client"

import { useEffect, useState } from "react"
import { Radar, Sparkles, Plane } from "lucide-react"
import type { ApexReceipts as Receipts } from "@/lib/apex/receipts"

/**
 * "Receipts" hero — proof of what Apex did while the user was away (welcome
 * review #8). Leads the Apex screen: what the agent found, not what the user
 * could do. Renders only when there's something real to report.
 */
export default function ApexReceipts() {
  const [r, setR] = useState<Receipts | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/apex/receipts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { receipts?: Receipts | null } | null) => {
        if (alive) setR(data?.receipts ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!r || r.scanned <= 0) return null

  const window = r.hoursBack === 24 ? "In the last 24 hours" : `In the last ${r.hoursBack} hours`

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        While you were away
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
        {window}, Apex scanned{" "}
        <span className="font-semibold text-slate-950">{r.scanned.toLocaleString("en-US")}</span> new roles
        {r.matched > 0 ? (
          <>
            {" "}— <span className="font-semibold text-slate-950">{r.matched.toLocaleString("en-US")}</span>{" "}
            matched your profile
            {r.sponsorVerified > 0 && (
              <>
                ,{" "}
                <span className="font-semibold text-emerald-700">
                  {r.sponsorVerified.toLocaleString("en-US")} sponsor-verified
                </span>
              </>
            )}
            .
          </>
        ) : (
          <> and kept your queue fresh.</>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Radar className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {r.scanned.toLocaleString("en-US")} scanned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {r.matched.toLocaleString("en-US")} matched
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Plane className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> {r.sponsorVerified.toLocaleString("en-US")}{" "}
          sponsor-verified
        </span>
      </div>
    </section>
  )
}
