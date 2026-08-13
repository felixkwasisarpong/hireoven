"use client"

import { useMemo, useState } from "react"
import { ChevronDown, FileSearch, Quote } from "lucide-react"
import type { ApplicationXRay, XRaySourceFact } from "@/lib/application-xray/types"
import { cn } from "@/lib/utils"
import { presentAuthorizationNote, presentSourceFact } from "./xray-presenters"

function sortedFacts(facts: XRaySourceFact[]): XRaySourceFact[] {
  return [...facts].sort((a, b) => {
    const aTime = Date.parse(a.observedAt ?? a.computedAt ?? "")
    const bTime = Date.parse(b.observedAt ?? b.computedAt ?? "")
    const safeA = Number.isFinite(aTime) ? aTime : 0
    const safeB = Number.isFinite(bTime) ? bTime : 0
    return safeB - safeA || a.id.localeCompare(b.id)
  })
}

export function XRayEvidenceDrawer({
  xray,
  onToggle,
}: {
  xray: ApplicationXRay
  onToggle?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const facts = useMemo(() => sortedFacts(xray.sourceFacts).slice(0, 8), [xray.sourceFacts])
  const authNote = presentAuthorizationNote(xray)

  function toggle() {
    const next = !open
    setOpen(next)
    onToggle?.(next)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      >
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
          <FileSearch className="h-4 w-4 text-slate-400" aria-hidden />
          Evidence and gaps
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-slate-400 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-3.5 py-3 dark:border-slate-800">
          {authNote ? (
            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11.5px] leading-relaxed text-sky-900 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100">
              {authNote}
            </div>
          ) : null}

          {facts.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              No supporting source facts are available in the current response.
            </p>
          ) : (
            <ul className="space-y-3">
              {facts.map((fact) => {
                const presentation = presentSourceFact(fact)
                return (
                  <li key={fact.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                        {presentation.sourceLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                        {presentation.basisLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                        {presentation.confidenceLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {presentation.explanation}
                    </p>
                    <p className="mt-1 text-[10.5px] font-medium text-slate-400">
                      {presentation.dateLabel}
                      {presentation.sampleLabel ? ` - ${presentation.sampleLabel}` : ""}
                    </p>
                    {presentation.excerpt ? (
                      <div className="mt-2 flex gap-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950">
                        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {presentation.excerpt}
                        </p>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
