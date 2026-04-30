"use client"

import Link from "next/link"
import { ArrowRight, Search, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ScoutAction } from "@/lib/scout/types"
import { buildFeedUrl } from "@/lib/scout/workspace"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
}

function FilterTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs">
      <span className="font-medium text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </span>
  )
}

function getReadableAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (/^\s*[{[]/.test(trimmed)) return "Scout prepared a search based on your request."
  return trimmed
}

export function SearchMode({ response, onFollowUp }: Props) {
  const filterAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "APPLY_FILTERS" }> => a.type === "APPLY_FILTERS"
  )
  const filters = filterAction?.payload
  const feedUrl = buildFeedUrl(response)
  const answerText = getReadableAnswer(response.answer)

  const filterTags: { label: string; value: string }[] = []
  if (filters?.query) filterTags.push({ label: "Role", value: String(filters.query) })
  if (filters?.location) filterTags.push({ label: "Location", value: String(filters.location) })
  if (filters?.workMode) filterTags.push({ label: "Work mode", value: String(filters.workMode) })
  if (filters?.sponsorship) filterTags.push({ label: "Sponsorship", value: String(filters.sponsorship) })

  return (
    <div className="space-y-5">
      {/* Scout answer strip */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="h-[3px] w-full rounded-full bg-[#FF5C18] opacity-80 -mt-3 -mx-4 mb-3 rounded-t-2xl w-[calc(100%+2rem)]" />
          <p className="text-sm leading-6 text-gray-700">{answerText}</p>
        </div>
      </div>

      {/* Search result card */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
            <Search className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Job search ready</p>
            <p className="text-[11px] text-gray-400">
              Scout prepared a filtered search based on your request
            </p>
          </div>
        </div>

        {/* Filters */}
        {filterTags.length > 0 && (
          <div className="border-b border-gray-100 px-5 py-4">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Applied filters
            </p>
            <div className="flex flex-wrap gap-2">
              {filterTags.map(({ label, value }) => (
                <FilterTag key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="px-5 py-4">
          <Link
            href={feedUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Open job feed
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-2 text-[11px] text-gray-400">
            The feed will show jobs matching Scout&apos;s suggested filters.
          </p>
        </div>
      </div>

      {/* Quick follow-up suggestions */}
      <div>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          Refine this search
        </p>
        <div className="flex flex-wrap gap-2">
          {["Make these more senior", "Remote only", "Add H-1B sponsorship filter", "Sort by most recent"].map(
            (chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onFollowUp(chip)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
              >
                {chip}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
