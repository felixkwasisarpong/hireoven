"use client"

/**
 * Active outreach engine UI. Lists the user's multi-touch sequences, surfaces
 * which follow-ups are due, and lets them copy/edit each draft, mark it sent,
 * or mark the contact as replied (which stops the remaining follow-ups).
 * Apex never sends — every touch is a manual, reviewed send.
 */
import { useCallback, useEffect, useState } from "react"
import { Check, Clock, Copy, Loader2, Plus, Reply, Send, Trash2, X } from "lucide-react"

type Step = {
  stepNumber: number
  kind: "initial" | "follow_up" | "final"
  purpose: string
  draft: string
  status: "pending" | "sent" | "skipped"
  scheduledFor: string
  sentAt: string | null
}
type Sequence = {
  id: string
  goal: "referral_request" | "recruiter_intro" | "hiring_manager"
  channel: "linkedin" | "email"
  contact_name: string | null
  contact_role: string | null
  company_name: string | null
  job_title: string | null
  status: "active" | "replied" | "completed" | "stopped"
  next_due_at: string | null
  created_at: string
  steps: Step[]
}

const GOAL_LABEL: Record<Sequence["goal"], string> = {
  referral_request: "Referral",
  recruiter_intro: "Recruiter",
  hiring_manager: "Hiring manager",
}
const STATUS_STYLE: Record<Sequence["status"], string> = {
  active: "bg-blue-50 text-blue-700",
  replied: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-500",
  stopped: "bg-slate-100 text-slate-400",
}

function isDue(s: Step): boolean {
  return s.status === "pending" && new Date(s.scheduledFor) <= new Date()
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function OutreachSequences() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/apex/outreach/sequences", { cache: "no-store" })
    if (res.ok) setSequences((await res.json()).sequences ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dueCount = sequences.filter((s) => s.status === "active" && s.steps.some(isDue)).length

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your outreach…
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-slate-500">
          {dueCount > 0 ? (
            <span className="font-semibold text-blue-700">{dueCount} follow-up{dueCount === 1 ? "" : "s"} due now</span>
          ) : (
            "Multi-touch outreach to recruiters, hiring managers, and referrers."
          )}
        </p>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800"
        >
          {showNew ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showNew ? "Cancel" : "New sequence"}
        </button>
      </div>

      {showNew && <NewSequenceForm onCreated={() => { setShowNew(false); void load() }} />}

      {sequences.length === 0 && !showNew && (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center">
          <p className="text-[15px] font-semibold text-slate-700">No outreach yet</p>
          <p className="mt-1 text-[13px] text-slate-500">Start a sequence to a recruiter or hiring manager and Apex drafts the whole cadence.</p>
        </div>
      )}

      <div className="space-y-4">
        {sequences.map((seq) => (
          <SequenceCard key={seq.id} seq={seq} onChange={load} />
        ))}
      </div>
    </div>
  )
}

function NewSequenceForm({ onCreated }: { onCreated: () => void }) {
  const [goal, setGoal] = useState<Sequence["goal"]>("recruiter_intro")
  const [channel, setChannel] = useState<Sequence["channel"]>("linkedin")
  const [companyName, setCompanyName] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactRole, setContactRole] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!companyName.trim()) return
    setSaving(true)
    const res = await fetch("/api/apex/outreach/sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, channel, companyName, jobTitle, contactName, contactRole }),
    })
    setSaving(false)
    if (res.ok) onCreated()
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13.5px] focus:border-slate-400 focus:outline-none"

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Goal</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value as Sequence["goal"])} className={input}>
            <option value="recruiter_intro">Recruiter intro</option>
            <option value="hiring_manager">Hiring manager</option>
            <option value="referral_request">Referral request</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Sequence["channel"])} className={input}>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company *</span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={input} placeholder="Stripe" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Role (optional)</span>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={input} placeholder="Senior Backend Engineer" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact name</span>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={input} placeholder="optional" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact role</span>
          <input value={contactRole} onChange={(e) => setContactRole(e.target.value)} className={input} placeholder="optional" />
        </label>
      </div>
      <button
        onClick={submit}
        disabled={saving || !companyName.trim()}
        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {saving ? "Drafting cadence…" : "Generate sequence"}
      </button>
    </div>
  )
}

function SequenceCard({ seq, onChange }: { seq: Sequence; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    await fetch(`/api/apex/outreach/sequences/${seq.id}`, {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: action === "delete" ? undefined : JSON.stringify({ action, ...extra }),
    })
    await onChange()
    setBusy(false)
  }

  function copy(step: Step) {
    void navigator.clipboard.writeText(step.draft)
    setCopied(step.stepNumber)
    setTimeout(() => setCopied(null), 1500)
  }

  const title = [seq.job_title, seq.company_name].filter(Boolean).join(" · ") || seq.company_name || "Outreach"

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14.5px] font-bold text-slate-900">{title}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ${STATUS_STYLE[seq.status]}`}>{seq.status}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-slate-400">
            {GOAL_LABEL[seq.goal]} · {seq.channel === "linkedin" ? "LinkedIn" : "Email"}
            {seq.contact_name ? ` · ${seq.contact_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {seq.status === "active" && (
            <button
              onClick={() => act("mark_replied")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
              title="They replied — stop follow-ups"
            >
              <Reply className="h-3.5 w-3.5" /> Replied
            </button>
          )}
          <button onClick={() => act("delete")} disabled={busy} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-red-500" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ol className="divide-y divide-slate-100">
        {seq.steps.map((step) => {
          const due = isDue(step)
          return (
            <li key={step.stepNumber} className={`px-5 py-3.5 ${step.status === "skipped" ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-bold text-slate-500">{step.stepNumber}</span>
                  <span className="text-[12.5px] font-semibold capitalize text-slate-700">{step.kind.replace("_", " ")}</span>
                  {step.status === "sent" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><Check className="h-3 w-3" /> sent {step.sentAt ? fmtDate(step.sentAt) : ""}</span>
                  ) : step.status === "skipped" ? (
                    <span className="text-[11px] text-slate-400">skipped</span>
                  ) : due ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-blue-700"><Clock className="h-3 w-3" /> due now</span>
                  ) : (
                    <span className="text-[11px] text-slate-400">scheduled {fmtDate(step.scheduledFor)}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => copy(step)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11.5px] font-medium text-slate-500 transition hover:text-slate-800">
                    {copied === step.stepNumber ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === step.stepNumber ? "Copied" : "Copy"}
                  </button>
                  {step.status === "pending" && seq.status === "active" && (
                    <button
                      onClick={() => act("mark_sent", { stepNumber: step.stepNumber })}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[11.5px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" /> Sent
                    </button>
                  )}
                </div>
              </div>
              {step.status !== "skipped" && (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">{step.draft}</p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
