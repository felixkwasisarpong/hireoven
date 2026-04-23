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
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6A789D]" />
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search title, company, skills, location…"
          className="w-full rounded-xl border border-[#D7DCEA] bg-white py-3 pl-10 pr-10 text-sm text-strong outline-none transition-colors focus:border-[#8A80FA] focus:ring-2 focus:ring-[#DBD6FF]"
        />
        {draft && (
          <button
            type="button"
            onClick={clearQuery}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#F3F5FB] hover:text-strong"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query && totalCount !== undefined && (
        <p className="pl-0.5 text-xs text-muted-foreground">
          {totalCount.toLocaleString()} result{totalCount === 1 ? "" : "s"} for{" "}
          <span className="font-medium text-strong">&ldquo;{query}&rdquo;</span>
        </p>
      )}
    </div>
  )
}
