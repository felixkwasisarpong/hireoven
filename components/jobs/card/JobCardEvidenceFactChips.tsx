"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Briefcase, Building2, Home, MapPin, CircleDollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type JobCardFactId,
  type JobCardFactItem,
  formatEmploymentTypeForCard,
  formatWorkModeForCard,
  labelEvidenceSource,
} from "@/lib/jobs/job-evidence-facts"
import type { EvidenceBackedJobFact, NormalizedSalary } from "@/types/job-evidence-facts"

type JobCardEvidenceFactChipsProps = {
  jobId: string
  items: JobCardFactItem[]
  className?: string
}

function valueSummary(id: JobCardFactId, fact: EvidenceBackedJobFact<unknown>): string {
  if (id === "location") {
    const v = fact.value as string[] | null
    if (!v?.length) return "—"
    if (v.length > 2) {
      return `${v[0]} +${v.length - 1} locations`
    }
    if (v.length === 2) return v.join(" · ")
    return v[0] ?? "—"
  }
  if (id === "workMode") {
    const w = fact.value as "remote" | "hybrid" | "onsite" | "unknown" | null
    return (w && formatWorkModeForCard(w)) || "—"
  }
  if (id === "employmentType") {
    const e = fact.value as Parameters<typeof formatEmploymentTypeForCard>[0] | null
    return (e && formatEmploymentTypeForCard(e)) || "—"
  }
  if (id === "salary") {
    const s = fact.value as NormalizedSalary | null
    if (s == null || s.kind === "not_found") return "—"
    if (s.min != null && s.max != null) {
      if (s.kind === "estimated") {
        return `Estimated $${Math.round(s.min / 1000)}k–$${Math.round(s.max / 1000)}k`
      }
      if (s.period === "hour") {
        if (s.min === s.max) return `$${s.min}/hr`
        return `$${s.min}–$${s.max}/hr`
      }
      return `$${Math.round(s.min / 1000)}k–$${Math.round(s.max / 1000)}k`
    }
  }
  return "—"
}

function IconFor({ id, className }: { id: JobCardFactId; className?: string }) {
  if (id === "location") return <MapPin className={className} aria-hidden />
  if (id === "salary") return <CircleDollarSign className={className} aria-hidden />
  if (id === "employmentType") return <Briefcase className={className} aria-hidden />
  if (id === "workMode") return <Home className={className} aria-hidden />
  return null
}

function WorkModeIcon({ workMode, className }: { workMode: string | null; className?: string }) {
  const w = workMode?.toLowerCase() ?? ""
  if (w.includes("on-site") || w.includes("hybrid")) {
    return <Building2 className={className} aria-hidden />
  }
  return <Home className={className} aria-hidden />
}

function EvidencePanel({
  item,
  anchorId,
  open,
  onClose,
  root,
}: {
  item: JobCardFactItem
  anchorId: string
  open: boolean
  onClose: () => void
  root: HTMLElement
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const anchor = typeof document === "undefined" ? null : document.getElementById(anchorId)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    function place() {
      const a = document.getElementById(anchorId)
      if (!a) return
      const rect = a.getBoundingClientRect()
      const panelW = 288
      const maxLeft = Math.max(8, window.innerWidth - panelW - 8)
      setPos({
        top: rect.bottom + 8,
        left: Math.min(Math.max(8, rect.left), maxLeft),
      })
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, anchor, anchorId])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      const a = document.getElementById(anchorId)
      if (a?.contains(t)) return
      onClose()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, onClose, anchorId])

  if (!open || !root || !anchor) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${item.factTitle} details`}
      className="fixed z-[200] w-[min(18rem,calc(100vw-1rem))] max-h-[min(20rem,70vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-left text-[12px] text-slate-600 shadow-lg"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.factTitle}</p>
      <p className="mt-1.5 text-[14px] font-semibold text-slate-900">{valueSummary(item.id, item.fact)}</p>
      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[12px]">
        <p>
          <span className="text-slate-500">Source:</span> {labelEvidenceSource(item.fact.source)}
        </p>
        <p>
          <span className="text-slate-500">Confidence:</span> {item.fact.confidence}
        </p>
      </div>
      {item.fact.evidence.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-1 text-[12px] text-slate-600">
          {item.fact.evidence.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {item.fact.reason && (
        <p className="mt-2 rounded-md bg-amber-50/90 px-2 py-1.5 text-[11.5px] leading-snug text-amber-950">
          <span className="font-semibold">Note: </span>
          {item.fact.reason}
        </p>
      )}
    </div>,
    root
  )
}

function FactChip({
  jobId,
  item,
  openId,
  setOpenId,
}: {
  jobId: string
  item: JobCardFactItem
  openId: JobCardFactId | null
  setOpenId: (v: JobCardFactId | null) => void
}) {
  const baseId = useId()
  const anchorId = `job-fact-${jobId}-${item.id}-${baseId}`
  const isOpen = openId === item.id
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setRoot(document.body)
  }, [])

  const onClose = useCallback(() => setOpenId(null), [setOpenId])
  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setOpenId(isOpen ? null : item.id)
    },
    [isOpen, item.id, setOpenId]
  )

  return (
    <>
      <button
        type="button"
        id={anchorId}
        onClick={onToggle}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md px-0.5 text-left text-[12.5px] text-slate-500 transition hover:bg-slate-50/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/20",
          isOpen && "text-slate-800"
        )}
      >
        {item.id === "workMode" ? (
          <WorkModeIcon workMode={item.displayText} className="h-3 w-3 shrink-0 text-slate-400" />
        ) : (
          <IconFor id={item.id} className="h-3 w-3 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 truncate">
          {item.id === "salary" ? <span className="font-semibold text-emerald-800">{item.displayText}</span> : item.displayText}
        </span>
      </button>
      {root && <EvidencePanel item={item} anchorId={anchorId} open={isOpen} onClose={onClose} root={root} />}
    </>
  )
}

export function JobCardEvidenceFactChips({ jobId, items, className }: JobCardEvidenceFactChipsProps) {
  const [openId, setOpenId] = useState<JobCardFactId | null>(null)
  if (items.length === 0) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)} onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <FactChip key={item.id} jobId={jobId} item={item} openId={openId} setOpenId={setOpenId} />
      ))}
    </div>
  )
}
