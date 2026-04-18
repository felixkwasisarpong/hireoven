"use client"

import { useEffect, useState } from "react"
import { Search, X } from "lucide-react"
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation"

export function getSearchQuery(
  params: URLSearchParams | ReadonlyURLSearchParams
) {
  return params.get("q")?.trim() ?? ""
}

export function searchQueryToParams(
  current: URLSearchParams | ReadonlyURLSearchParams,
  query: string
) {
  const next = new URLSearchParams(current.toString())
  if (query.trim()) next.set("q", query.trim())
  else next.delete("q")
  return next
}

interface JobSearchProps {
  totalCount?: number
}

export default function JobSearch({ totalCount }: JobSearchProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = getSearchQuery(searchParams)
  const [draft, setDraft] = useState(query)

  useEffect(() => {
    setDraft(query)
  }, [query])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (draft === query) return
      const next = searchQueryToParams(searchParams, draft)
      const value = next.toString()
      router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [draft, pathname, query, router, searchParams])

  function clearQuery() {
    setDraft("")
    const next = searchQueryToParams(searchParams, "")
    const value = next.toString()
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search title, company, skills, location…"
          className="w-full rounded-[16px] border border-slate-200/80 bg-white py-3.5 pl-11 pr-11 text-sm text-slate-900 outline-none transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/20"
        />
        {draft && (
          <button
            type="button"
            onClick={clearQuery}
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query && totalCount !== undefined && (
        <p className="pl-1 text-xs text-slate-500">
          {totalCount.toLocaleString()} result{totalCount === 1 ? "" : "s"} for{" "}
          <span className="font-medium text-slate-700">&ldquo;{query}&rdquo;</span>
        </p>
      )}
    </div>
  )
}
