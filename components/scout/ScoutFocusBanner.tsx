"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Focus, X } from "lucide-react"

export function ScoutFocusBanner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  function turnOff() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("focus")
    // Only remove sort=match if it was set by focus mode (not by the user directly).
    // We use the presence of focus=1 to infer this, which we already checked.
    params.delete("sort")
    const qs = params.toString()
    router.push(`/dashboard${qs ? `?${qs}` : ""}`)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm"
    >
      <Focus className="h-4 w-4 shrink-0 text-orange-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-orange-800">Scout Focus Mode is on</span>
        <span className="ml-2 text-orange-600">
          Sorted by best match · prioritizing recent and sponsored roles
        </span>
      </div>
      <button
        type="button"
        onClick={turnOff}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-100"
      >
        <X className="h-3 w-3" />
        Turn off
      </button>
    </div>
  )
}
