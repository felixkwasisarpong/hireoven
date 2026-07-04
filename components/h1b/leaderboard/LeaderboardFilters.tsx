"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"

const US_STATES = [
  "CA", "TX", "NY", "WA", "MA", "IL", "NJ", "VA", "FL", "GA", "PA", "NC", "OH",
  "MI", "CO", "AZ", "MD", "OR", "MN", "TN", "IN", "WI", "MO", "CT", "UT", "NV",
]

function cls(active: boolean): string {
  return active
    ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
    : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
}

const SELECT_CLS =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none transition-colors hover:bg-slate-50"

// URL-state-driven filters (no client store). Changing a control rewrites the
// query string and resets the keyset cursor. `lockState` / `lockIndustry` hide a
// control on the scoped by-state / by-industry pages.
export default function LeaderboardFilters({
  industries,
  lockState,
  lockIndustry,
}: {
  industries: string[]
  lockState?: boolean
  lockIndustry?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value == null || value === "") next.delete(key)
      else next.set(key, value)
      next.delete("cursor") // new filter → start from the top
      next.delete("from") // and restart the sequential numbering
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [params, pathname, router]
  )

  const sort = params.get("sort") === "cert_rate" ? "cert_rate" : "volume"
  const excludeStaffing = params.get("exclude_staffing") === "true"

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <button className={cls(sort === "volume")} onClick={() => update("sort", null)}>
        Most filings
      </button>
      <button
        className={cls(sort === "cert_rate")}
        onClick={() => update("sort", "cert_rate")}
      >
        Highest cert. rate
      </button>

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <button
        className={cls(excludeStaffing)}
        onClick={() => update("exclude_staffing", excludeStaffing ? null : "true")}
      >
        Exclude staffing firms
      </button>

      <button
        className={cls(params.get("layoff_risk") === "exclude_active")}
        onClick={() =>
          update(
            "layoff_risk",
            params.get("layoff_risk") === "exclude_active" ? null : "exclude_active"
          )
        }
      >
        Exclude active layoffs
      </button>

      <button
        className={cls(params.get("cap_exempt_only") === "true")}
        onClick={() =>
          update("cap_exempt_only", params.get("cap_exempt_only") === "true" ? null : "true")
        }
      >
        Cap-exempt only
      </button>

      {!lockState && (
        <select
          className={SELECT_CLS}
          value={params.get("state") ?? ""}
          onChange={(e) => update("state", e.target.value || null)}
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {!lockIndustry && industries.length > 0 && (
        <select
          className={SELECT_CLS}
          value={params.get("industry") ?? ""}
          onChange={(e) => update("industry", e.target.value || null)}
          aria-label="Filter by industry"
        >
          <option value="">All industries</option>
          {industries.map((ind) => (
            <option key={ind} value={ind}>
              {ind}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
