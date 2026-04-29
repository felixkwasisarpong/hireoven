"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Focus, RefreshCw, SlidersHorizontal, User, X } from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { detectScoutMode, getScoutModeLabel } from "@/lib/scout/mode"

type ScoutContextChipProps = {
  /** Called after a reset so the parent can clear its local chat state */
  onReset?: () => void
  jobTitle?: string
  companyName?: string
}

export function ScoutContextChip({ onReset, jobTitle, companyName }: ScoutContextChipProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { primaryResume } = useResumeContext()

  const mode = detectScoutMode(pathname ?? "")
  const modeLabel = getScoutModeLabel(mode)

  const isFocusMode = searchParams.get("focus") === "1"
  const queryFilter = searchParams.get("q")
  const locationFilter = searchParams.get("location")
  const sponsorshipFilter = searchParams.get("sponsorship")
  const hasFilters = !!(queryFilter || locationFilter || sponsorshipFilter || searchParams.get("workMode"))

  // Only render if there is something meaningful to show
  const hasAnything = isFocusMode || hasFilters || primaryResume || jobTitle || companyName
  if (!hasAnything) return null

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("q")
    params.delete("location")
    params.delete("sponsorship")
    params.delete("workMode")
    params.delete("focus")
    params.delete("sort")
    const qs = params.toString()
    router.push(`/dashboard${qs ? `?${qs}` : ""}`)
  }

  function turnOffFocus() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("focus")
    params.delete("sort")
    const qs = params.toString()
    router.push(`/dashboard${qs ? `?${qs}` : ""}`)
  }

  function resetContext() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("scout:reset-context"))
    }
    router.push("/dashboard")
    onReset?.()
  }

  const activeFilters: string[] = []
  if (queryFilter) activeFilters.push(`"${queryFilter}"`)
  if (locationFilter) activeFilters.push(locationFilter)
  if (sponsorshipFilter) activeFilters.push(`${sponsorshipFilter} sponsorship`)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
      {/* Context tags */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Scout context
        </span>

        {/* Mode */}
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
          {modeLabel}
        </span>

        {/* Resume */}
        {primaryResume?.name && (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <User className="h-2.5 w-2.5" />
            {primaryResume.name}
          </span>
        )}

        {/* Active job / company */}
        {jobTitle && (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {jobTitle}
          </span>
        )}
        {companyName && !jobTitle && (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {companyName}
          </span>
        )}

        {/* Active filters */}
        {activeFilters.map((f) => (
          <span
            key={f}
            className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700"
          >
            {f}
          </span>
        ))}

        {/* Focus mode */}
        {isFocusMode && (
          <span className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
            <Focus className="h-2.5 w-2.5" />
            Focus Mode
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 active:scale-95"
          >
            <SlidersHorizontal className="h-2.5 w-2.5" />
            Clear filters
          </button>
        )}
        {isFocusMode && (
          <button
            type="button"
            onClick={turnOffFocus}
            className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-medium text-orange-700 transition hover:bg-orange-100 active:scale-95"
          >
            <X className="h-2.5 w-2.5" />
            Turn off Focus
          </button>
        )}
        <button
          type="button"
          onClick={resetContext}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 active:scale-95"
          title="Clear filters, focus mode, and Scout conversation"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Reset context
        </button>
      </div>
    </div>
  )
}
