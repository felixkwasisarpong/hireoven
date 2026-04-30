"use client"

import Link from "next/link"
import { ArrowRight, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutResponse, ScoutAction } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"
import { buildFeedUrl } from "@/lib/scout/workspace"
import { OpportunityPanel } from "@/components/scout/OpportunityPanel"
import { getScoutDisplayText } from "@/lib/scout/display-text"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
  activeEntities?: ActiveEntities
}

/** @deprecated — use getScoutDisplayText from lib/scout/display-text instead */
const getReadableAnswer = getScoutDisplayText

function FilterTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 py-1.5">
      <span className="w-20 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
        {label}
      </span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  )
}

export function SearchMode({ response, onFollowUp, activeEntities }: Props) {
  const filterAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "APPLY_FILTERS" }> => a.type === "APPLY_FILTERS"
  )
  const filters = filterAction?.payload
  const feedUrl = buildFeedUrl(response)

  const filterTags: { label: string; value: string }[] = []
  if (filters?.query)       filterTags.push({ label: "Role",       value: String(filters.query) })
  if (filters?.location)    filterTags.push({ label: "Location",   value: String(filters.location) })
  if (filters?.workMode)    filterTags.push({ label: "Work mode",  value: String(filters.workMode) })
  if (filters?.sponsorship) filterTags.push({ label: "H-1B",       value: String(filters.sponsorship) })

  const answerText = getReadableAnswer(response.answer)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_240px]">

      {/* ── Left: main action ─────────────────────────────────────────── */}
      <div className="space-y-4">

        {/* Search CTA card */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
              <Search className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Job search ready</p>
              <p className="text-[11px] text-gray-400">
                Filtered by Scout based on your request
              </p>
            </div>
          </div>

          {filterTags.length > 0 && (
            <div className="border-b border-gray-100 px-5 pb-2 pt-3 divide-y divide-gray-50">
              {filterTags.map(({ label, value }) => (
                <FilterTag key={label} label={label} value={value} />
              ))}
            </div>
          )}

          <div className="px-5 py-4">
            <Link
              href={feedUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open job feed
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Adjacent opportunities — rendered when job or company context exists */}
        {(activeEntities?.jobId || activeEntities?.companyId) && (
          <OpportunityPanel
            jobId={activeEntities?.jobId}
            companyId={activeEntities?.companyId}
            onLaunch={onFollowUp}
            maxItems={4}
          />
        )}

        {/* Refine chips */}
        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Refine
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              "Make these more senior",
              "Remote only",
              "Add H-1B sponsorship filter",
              "Sort by most recent",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onFollowUp(chip)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right: intelligence pane ───────────────────────────────────── */}
      <div className="hidden space-y-4 lg:block">
        {/* Scout reasoning */}
        {answerText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Scout reasoning
            </p>
            <p className="text-xs leading-5 text-gray-600">{answerText}</p>
          </div>
        )}

        {/* Active entity context */}
        {(activeEntities?.companyName || activeEntities?.jobTitle) && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Context
            </p>
            {activeEntities.companyName && (
              <p className="text-xs text-gray-600">
                <span className="font-medium">Company:</span> {activeEntities.companyName}
              </p>
            )}
            {activeEntities.jobTitle && (
              <p className="mt-1 text-xs text-gray-600">
                <span className="font-medium">Role:</span> {activeEntities.jobTitle}
              </p>
            )}
          </div>
        )}

        {/* Filters summary */}
        {filterTags.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Active filters
            </p>
            <div className="space-y-1">
              {filterTags.map(({ label, value }) => (
                <p key={label} className="text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{label}:</span> {value}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
