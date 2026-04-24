"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Clipboard, Check, FileText, Search, Star, Trash2 } from "lucide-react"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
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
    <div className="surface-card group p-5 transition-all duration-150 hover:-translate-y-px hover:shadow-[0_1px_0_rgba(15,23,42,0.04),0_12px_28px_rgba(15,23,42,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-kicker">{letter.company_name}</p>
          <h3 className="mt-1 truncate text-[15px] font-semibold text-gray-900">
            {letter.job_title}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void toggleFav()}
          className={cn(
            "flex-shrink-0 rounded-lg border p-1.5 transition-colors",
            isFav ? "border-amber-200 bg-amber-50 text-amber-500" : "border-slate-200/80 text-slate-300 hover:border-amber-200 hover:text-amber-400"
          )}
        >
          <Star className="h-3.5 w-3.5" fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[letter.tone, letter.length, letter.style.replace("_", " ")].map((tag) => (
          <span key={tag} className="rounded-full border border-slate-200/70 bg-slate-50 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-500">
            {tag}
          </span>
        ))}
        {letter.word_count && (
          <span className="rounded-full border border-slate-200/70 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {letter.word_count}w
          </span>
        )}
        {letter.was_used && (
          <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
            Used
          </span>
        )}
      </div>

      <p className="mt-3 text-[13px] leading-[1.65] text-slate-400 line-clamp-2">
        {letter.body.slice(0, 130)}…
      </p>

      <p className="mt-2 text-[11px] text-slate-400">{date}</p>

      <div className="mt-4 flex items-center gap-1.5 border-t border-slate-200/60 pt-3.5">
        {letter.job_id && (
          <Link
            href={`/dashboard/cover-letter/${letter.job_id}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200/80 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" />
            View / Edit
          </Link>
        )}

        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition",
            isCopied
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-slate-200/80 text-slate-600 hover:bg-slate-50"
          )}
        >
          {isCopied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
          {isCopied ? "Copied!" : "Copy"}
        </button>

        <button
          type="button"
          onClick={() => void handleDelete()}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200/80 px-2.5 py-1.5 text-[12px] font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
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
      const res = await fetch("/api/cover-letter", { credentials: "include", cache: "no-store" })
      if (!res.ok) {
        setLetters([])
        setIsLoading(false)
        return
      }
      const body = (await res.json()) as { coverLetters?: CoverLetter[] }
      setLetters(body.coverLetters ?? [])
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
    <main className="app-page">
      <div className="app-shell max-w-6xl space-y-5">
        <DashboardPageHeader
          kicker="Cover letters"
          title="Saved drafts, tailored for real roles"
          description="Keep every generated letter in one place, revisit the strongest ones, and reopen drafts when a live application needs one more pass."
          backHref="/dashboard"
          backLabel="Back to dashboard"
        />

        {/* Filters + search */}
        <div className="surface-card flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex rounded-xl border border-slate-200/80 bg-slate-50 p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-100",
                  filter === tab.value
                    ? "bg-white text-gray-900 shadow-[0_1px_4px_rgba(15,23,42,0.08)]"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search letters…"
              className="w-52 rounded-xl border border-slate-200/80 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-slate-400 outline-none focus:border-[#FF5C18]"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="surface-card h-48 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="empty-state">
            <FileText className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-base font-semibold text-gray-900">
              {search || filter !== "all"
                ? "No letters match your filters"
                : "No cover letters yet"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {!search && filter === "all" && (
                <>
                  Generate your first one from any job listing -{" "}
                  <Link href="/dashboard" className="font-medium text-[#FF5C18] underline">
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
