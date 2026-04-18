"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Clipboard, Check, FileText, Search, Star, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { CoverLetter } from "@/types"

type FilterTab = "all" | "favorited" | "used"

function CoverLetterCard({ letter, onDelete }: { letter: CoverLetter; onDelete: (id: string) => void }) {
  const [isCopied, setIsCopied] = useState(false)
  const [isFav, setIsFav] = useState(letter.is_favorite)

  async function copy() {
    await navigator.clipboard.writeText(letter.body)
    await fetch(`/api/cover-letter/${letter.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ was_used: true }),
    })
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 3000)
  }

  async function toggleFav() {
    const next = !isFav
    setIsFav(next)
    await fetch(`/api/cover-letter/${letter.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: next }),
    })
  }

  async function handleDelete() {
    if (!confirm("Delete this cover letter?")) return
    await fetch(`/api/cover-letter/${letter.id}`, { method: "DELETE" })
    onDelete(letter.id)
  }

  const date = new Date(letter.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 transition hover:shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
            {letter.company_name}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-gray-900">
            {letter.job_title}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void toggleFav()}
          className={cn(
            "shrink-0 rounded-xl border p-1.5 transition",
            isFav ? "border-amber-200 bg-amber-50 text-amber-600" : "border-gray-200 text-gray-400 hover:text-gray-600"
          )}
        >
          <Star className="h-3.5 w-3.5" fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
          {letter.tone}
        </span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
          {letter.length}
        </span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
          {letter.style.replace("_", " ")}
        </span>
        {letter.word_count && (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {letter.word_count}w
          </span>
        )}
        {letter.was_used && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Used
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-6 text-gray-500 line-clamp-2">
        {letter.body.slice(0, 120)}…
      </p>

      <p className="mt-2 text-xs text-gray-400">{date}</p>

      <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-4">
        {letter.job_id && (
          <Link
            href={`/dashboard/cover-letter/${letter.job_id}`}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
          >
            <FileText className="h-3.5 w-3.5" />
            View / Edit
          </Link>
        )}

        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
            isCopied
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-gray-200 text-gray-600 hover:bg-gray-50"
          )}
        >
          {isCopied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
          {isCopied ? "Copied!" : "Copy"}
        </button>

        <button
          type="button"
          onClick={() => void handleDelete()}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  )
}

export default function CoverLettersPage() {
  const [letters, setLetters] = useState<CoverLetter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await (supabase
        .from("cover_letters" as any)
        .select("*")
        .order("created_at", { ascending: false }) as any)
      setLetters((data as CoverLetter[]) ?? [])
      setIsLoading(false)
    }
    void load()
  }, [])

  const filtered = useMemo(() => {
    let result = letters
    if (filter === "favorited") result = result.filter((l) => l.is_favorite)
    if (filter === "used") result = result.filter((l) => l.was_used)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.job_title.toLowerCase().includes(q) ||
          l.company_name.toLowerCase().includes(q)
      )
    }
    return result
  }, [letters, filter, search])

  function handleDelete(id: string) {
    setLetters((prev) => prev.filter((l) => l.id !== id))
  }

  const TABS: Array<{ value: FilterTab; label: string }> = [
    { value: "all", label: `All (${letters.length})` },
    { value: "favorited", label: "Favorited" },
    { value: "used", label: "Used" },
  ]

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(3,105,161,0.08),_transparent_40%),linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_60%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Cover letters</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              All your generated letters in one place
            </p>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-2xl border border-gray-200 bg-white p-1">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "rounded-xl px-3.5 py-1.5 text-sm font-medium transition",
                  filter === tab.value
                    ? "bg-[#0369A1] text-white"
                    : "text-gray-500 hover:text-gray-900"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by job or company…"
              className="w-56 rounded-2xl border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-3xl bg-white" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center">
            <FileText className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-base font-semibold text-gray-900">
              {search || filter !== "all"
                ? "No letters match your filters"
                : "No cover letters yet"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {!search && filter === "all" && (
                <>
                  Generate your first one from any job listing —{" "}
                  <Link href="/dashboard" className="font-medium text-[#0369A1] underline">
                    browse jobs
                  </Link>
                </>
              )}
            </p>
          </div>
        )}

        {/* Letters grid */}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((letter) => (
              <CoverLetterCard key={letter.id} letter={letter} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
