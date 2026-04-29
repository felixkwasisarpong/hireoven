"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Briefcase,
  Building2,
  Calendar,
  CalendarCheck,
  DollarSign,
  ExternalLink,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cn } from "@/lib/utils"
import type { ApplicationStatus, InterviewFormat, InterviewOutcome, InterviewRound, JobApplication, OfferDetails } from "@/types"
import { InterviewPrep } from "./InterviewPrep"
import FeatureGate from "@/components/gates/FeatureGate"
import { ScoutFollowUpBlock } from "@/components/scout/ScoutFollowUpBlock"

const STATUS_META: Record<ApplicationStatus, { label: string; color: string }> = {
  saved: { label: "Saved", color: "bg-slate-100 text-slate-600 border-slate-200" },
  applied: { label: "Applied", color: "bg-blue-50 text-blue-700 border-blue-200" },
  phone_screen: { label: "Phone Screen", color: "bg-amber-50 text-amber-700 border-amber-200" },
  interview: { label: "Interview", color: "bg-orange-50 text-orange-700 border-orange-200" },
  final_round: { label: "Final Round", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  offer: { label: "Offer", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected", color: "bg-red-50 text-red-700 border-red-200" },
  withdrawn: { label: "Withdrawn", color: "bg-slate-100 text-slate-500 border-slate-200" },
}

const TABS = ["Overview", "Timeline", "Interviews", "Offer"] as const
type Tab = typeof TABS[number]

type Props = {
  application: JobApplication
  onClose: () => void
  onUpdate: (updates: Partial<JobApplication>) => Promise<void>
  onDelete: () => void
  onAddTimeline: (entry: { type?: string; note?: string; date?: string }) => Promise<void>
  onRemoveTimeline: (entryId: string) => Promise<void>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  app,
  onUpdate,
  onClose,
}: {
  app: JobApplication
  onUpdate: Props["onUpdate"]
  onClose: () => void
}) {
  const [notes, setNotes] = useState(app.notes ?? "")
  const [saving, setSaving] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleNotesChange(value: string) {
    setNotes(value)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(async () => {
      setSaving(true)
      await onUpdate({ notes: value })
      setSaving(false)
    }, 800)
  }

  const sm = STATUS_META[app.status]

  return (
    <div className="space-y-5">
      {app.job_id && (
        <div className="rounded-[12px] border border-orange-100 bg-[linear-gradient(to_bottom_right,#FFF7F2,#FFFFFF)] p-4">
          <p className="inline-flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#EA580C]">
            <Briefcase className="h-3.5 w-3.5" aria-hidden />
            Job profile
          </p>
          <p className="mt-2 text-[13px] leading-snug text-slate-700">
            Open your Hireoven listing for posting text, sponsorship signals, match tools, and Scout.
          </p>
          <Link
            href={`/dashboard/jobs/${app.job_id}`}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#FF5C18] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#ea580c] sm:w-auto"
            onClick={onClose}
          >
            View full job details <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/60 p-3.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Status</p>
          <span className={cn("mt-1.5 inline-block rounded-full border px-2.5 py-1 text-[11.5px] font-semibold", sm.color)}>
            {sm.label}
          </span>
        </div>
        <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/60 p-3.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Applied</p>
          <p className="mt-1.5 text-[13px] font-semibold text-slate-800">
            {app.applied_at ? formatDate(app.applied_at) : "-"}
          </p>
        </div>
        {app.match_score != null && (
          <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/60 p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Match score</p>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-800">{app.match_score}%</p>
          </div>
        )}
        {app.apply_url && (
          <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/60 p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Job link</p>
            <a
              href={app.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#FF5C18] hover:underline"
            >
              View posting <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Notes</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
        <textarea
          rows={5}
          placeholder="Add notes about this application…"
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          className="w-full resize-none rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      <ScoutFollowUpBlock app={app} />
    </div>
  )
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

function TimelineTab({
  app,
  onAddTimeline,
  onRemoveTimeline,
}: {
  app: JobApplication
  onAddTimeline: Props["onAddTimeline"]
  onRemoveTimeline: Props["onRemoveTimeline"]
}) {
  const [note, setNote] = useState("")
  const [adding, setAdding] = useState(false)

  async function addNote() {
    if (!note.trim()) return
    setAdding(true)
    await onAddTimeline({ type: "note", note })
    setNote("")
    setAdding(false)
  }

  const sorted = [...(app.timeline ?? [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add a note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void addNote() }}
          className="flex-1 rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={addNote}
          disabled={adding || !note.trim()}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#ea580c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c2410c] disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      <div className="relative space-y-0">
        <div className="absolute left-[19px] top-0 h-full w-px bg-slate-200" />
        {sorted.map((entry) => (
          <div key={entry.id} className="group relative flex gap-3 py-2.5">
            <div className={cn(
              "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2",
              entry.type === "status_change" ? "border-[#FF5C18] bg-[#FFF1E8]" : "border-slate-200 bg-white"
            )}>
              {entry.type === "status_change"
                ? <CalendarCheck className="h-4 w-4 text-[#FF5C18]" />
                : <MessageSquare className="h-4 w-4 text-slate-400" />
              }
            </div>
            <div className="min-w-0 flex-1 pt-1.5">
              {entry.type === "status_change" && entry.status && (
                <p className="text-[13px] font-semibold text-slate-800">
                  Moved to{" "}
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", STATUS_META[entry.status]?.color)}>
                    {STATUS_META[entry.status]?.label}
                  </span>
                </p>
              )}
              {entry.note && (
                <p className="text-[13px] text-slate-700">{entry.note}</p>
              )}
              <p className="mt-0.5 text-[11px] text-slate-400">
                {formatDate(entry.date)} · {formatTime(entry.date)}
              </p>
            </div>
            {!entry.auto && (
              <button
                type="button"
                onClick={() => onRemoveTimeline(entry.id)}
                className="mt-1 opacity-0 transition group-hover:opacity-100"
                aria-label="Remove entry"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Interviews Tab ───────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<InterviewFormat, string> = {
  phone: "Phone",
  video: "Video",
  in_person: "In Person",
  take_home: "Take-home",
}

const OUTCOME_STYLE: Record<InterviewOutcome, string> = {
  pending: "bg-slate-50 text-slate-500 border-slate-200",
  passed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-600 border-red-200",
  unknown: "bg-slate-50 text-slate-400 border-slate-100",
}

function InterviewsTab({ app, onUpdate }: { app: JobApplication; onUpdate: Props["onUpdate"] }) {
  const [adding, setAdding] = useState(false)
  const [newRound, setNewRound] = useState<Partial<InterviewRound>>({
    format: "video",
    outcome: "pending",
    round_name: "",
  })
  const [saving, setSaving] = useState(false)

  async function saveRound() {
    if (!newRound.round_name?.trim()) return
    setSaving(true)
    const round: InterviewRound = {
      id: crypto.randomUUID(),
      round_name: newRound.round_name,
      format: newRound.format ?? "video",
      outcome: newRound.outcome ?? "pending",
      date: newRound.date,
      interviewer: newRound.interviewer,
      notes: newRound.notes,
    }
    await onUpdate({ interviews: [...(app.interviews ?? []), round] })
    setAdding(false)
    setNewRound({ format: "video", outcome: "pending", round_name: "" })
    setSaving(false)
  }

  async function updateOutcome(id: string, outcome: InterviewOutcome) {
    const updated = (app.interviews ?? []).map((r) => r.id === id ? { ...r, outcome } : r)
    await onUpdate({ interviews: updated })
  }

  async function removeRound(id: string) {
    await onUpdate({ interviews: (app.interviews ?? []).filter((r) => r.id !== id) })
  }

  return (
    <div className="space-y-3">
      {(app.interviews ?? []).map((round) => (
        <div key={round.id} className="rounded-[12px] border border-slate-200/80 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-800">{round.round_name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span>{FORMAT_LABELS[round.format]}</span>
                {round.date && <span>· {formatDate(round.date)}</span>}
                {round.interviewer && <span>· {round.interviewer}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={round.outcome}
                onChange={(e) => updateOutcome(round.id, e.target.value as InterviewOutcome)}
                className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold focus:outline-none", OUTCOME_STYLE[round.outcome])}
              >
                <option value="pending">Pending</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="unknown">Unknown</option>
              </select>
              <button onClick={() => removeRound(round.id)} aria-label="Remove round">
                <X className="h-3.5 w-3.5 text-slate-300 hover:text-red-400 transition" />
              </button>
            </div>
          </div>
          {round.notes && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{round.notes}</p>
          )}
        </div>
      ))}

      {adding ? (
        <div className="rounded-[12px] border border-[#FF5C18]/30 bg-[#FFFAF7] p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">New round</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Round name (e.g. Technical)"
              value={newRound.round_name ?? ""}
              onChange={(e) => setNewRound((p) => ({ ...p, round_name: e.target.value }))}
              className="col-span-2 rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none"
            />
            <select
              value={newRound.format}
              onChange={(e) => setNewRound((p) => ({ ...p, format: e.target.value as InterviewFormat }))}
              className="rounded-[8px] border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none"
            >
              <option value="phone">Phone</option>
              <option value="video">Video</option>
              <option value="in_person">In Person</option>
              <option value="take_home">Take-home</option>
            </select>
            <input
              type="date"
              value={newRound.date ?? ""}
              onChange={(e) => setNewRound((p) => ({ ...p, date: e.target.value }))}
              className="rounded-[8px] border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none"
            />
            <input
              placeholder="Interviewer (optional)"
              value={newRound.interviewer ?? ""}
              onChange={(e) => setNewRound((p) => ({ ...p, interviewer: e.target.value }))}
              className="col-span-2 rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none"
            />
            <textarea
              placeholder="Notes (optional)"
              rows={2}
              value={newRound.notes ?? ""}
              onChange={(e) => setNewRound((p) => ({ ...p, notes: e.target.value }))}
              className="col-span-2 resize-none rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveRound}
              disabled={saving || !newRound.round_name?.trim()}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#ea580c] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-[8px] border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition hover:border-[#FF5C18] hover:text-[#FF5C18]"
        >
          <Plus className="h-4 w-4" />
          Add interview round
        </button>
      )}

      {(app.interviews ?? []).length > 0 && (
        <div className="border-t border-slate-100 pt-4">
          <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Interview prep</p>
          <FeatureGate feature="interview_prep" promptVariant="inline">
            <InterviewPrep applicationId={app.id} />
          </FeatureGate>
        </div>
      )}
    </div>
  )
}

// ─── Offer Tab ────────────────────────────────────────────────────────────────

function OfferTab({ app, onUpdate }: { app: JobApplication; onUpdate: Props["onUpdate"] }) {
  const [offer, setOffer] = useState<OfferDetails>(app.offer_details ?? {})
  const [saving, setSaving] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(key: keyof OfferDetails, value: string | number | undefined) {
    const updated = { ...offer, [key]: value }
    setOffer(updated)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(async () => {
      setSaving(true)
      await onUpdate({ offer_details: updated })
      setSaving(false)
    }, 800)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Offer details</p>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { key: "base_salary", label: "Base salary", type: "number", prefix: "$" },
          { key: "signing_bonus", label: "Signing bonus", type: "number", prefix: "$" },
          { key: "annual_bonus_target", label: "Bonus target", type: "number", prefix: "$" },
        ].map(({ key, label, type, prefix }) => (
          <div key={key}>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{prefix}</span>
              <input
                type={type}
                value={(offer as any)[key] ?? ""}
                onChange={(e) => handleChange(key as keyof OfferDetails, e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 py-2.5 pl-7 pr-3 text-sm text-slate-800 focus:outline-none"
              />
            </div>
          </div>
        ))}

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Equity</label>
          <input
            type="text"
            placeholder="e.g. 0.1% or $50K RSUs"
            value={offer.equity ?? ""}
            onChange={(e) => handleChange("equity", e.target.value || undefined)}
            className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Offer deadline</label>
          <input
            type="date"
            value={offer.offer_deadline ?? ""}
            onChange={(e) => handleChange("offer_deadline", e.target.value || undefined)}
            className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 focus:outline-none"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Benefits notes</label>
          <textarea
            rows={3}
            placeholder="Health, dental, 401k, PTO…"
            value={offer.benefits_notes ?? ""}
            onChange={(e) => handleChange("benefits_notes", e.target.value || undefined)}
            className="w-full resize-none rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </div>

      {offer.base_salary && (
        <div className="rounded-[12px] bg-emerald-50 border border-emerald-100 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600 mb-2">Total compensation estimate</p>
          <p className="text-2xl font-bold text-emerald-800">
            ${((offer.base_salary ?? 0) + (offer.signing_bonus ?? 0) + (offer.annual_bonus_target ?? 0)).toLocaleString()}
          </p>
          <p className="text-[11.5px] text-emerald-600 mt-0.5">base + signing + bonus</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function ApplicationDrawer({ application, onClose, onUpdate, onDelete, onAddTimeline, onRemoveTimeline }: Props) {
  const [tab, setTab] = useState<Tab>("Overview")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [onClose])

  const sm = STATUS_META[application.status]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-200/80 px-5 py-4">
          <CompanyLogo
            companyName={application.company_name}
            domain={application.company_domain ?? undefined}
            logoUrl={application.company_logo_url}
            className="h-11 w-11 shrink-0 rounded-xl"
          />

          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {application.company_name}
            </p>
            <p className="mt-0.5 truncate font-semibold leading-snug text-slate-900">
              {application.job_title}
            </p>
            <span className={cn("mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold", sm.color)}>
              {sm.label}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
              aria-label="Delete application"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200/70 px-5">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "border-b-2 px-3 py-3 text-[13px] font-medium transition",
                tab === t
                  ? "border-[#FF5C18] text-[#FF5C18]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {tab === "Overview" && (
            <OverviewTab app={application} onUpdate={onUpdate} onClose={onClose} />
          )}
          {tab === "Timeline" && (
            <TimelineTab app={application} onAddTimeline={onAddTimeline} onRemoveTimeline={onRemoveTimeline} />
          )}
          {tab === "Interviews" && (
            <InterviewsTab app={application} onUpdate={onUpdate} />
          )}
          {tab === "Offer" && (
            <OfferTab app={application} onUpdate={onUpdate} />
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-[20px] bg-white p-6 shadow-2xl">
            <p className="font-semibold text-slate-900">Archive application?</p>
            <p className="mt-1.5 text-sm text-slate-500">
              This will hide {application.company_name} from your pipeline. You can&apos;t undo this.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => { onDelete(); onClose() }}
                className="flex-1 rounded-[10px] bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                Archive
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-[10px] border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
