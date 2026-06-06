"use client"

import { useState } from "react"
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReferralConnection, ReferralDraftResult } from "@/app/api/apex/referral-draft/route"

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  applyUrl: string | null
  applicationStatus?: string
  onClose: () => void
}

type Step = "form" | "generating" | "result"

const WARMTH_OPTIONS: { value: ReferralConnection["warmth"]; label: string; desc: string }[] = [
  { value: "high",   label: "Close",      desc: "Real working relationship" },
  { value: "medium", label: "Friendly",   desc: "Know each other, not close" },
  { value: "low",    label: "Loose",      desc: "Acquaintance / alumni" },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

export default function ReferralDraftModal({
  jobId,
  jobTitle,
  companyName,
  applyUrl,
  applicationStatus,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>("form")
  const [draft, setDraft] = useState<ReferralDraftResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<ReferralConnection>({
    name: "",
    their_role_at_company: "",
    relationship: "",
    warmth: "medium",
    last_interaction: "",
  })

  const appStatus = applicationStatus ?? "not yet applied"

  async function generate() {
    if (!form.name || !form.relationship) return
    setStep("generating")
    setError(null)
    try {
      const res = await fetch("/api/apex/referral-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          connection: { ...form, last_interaction: form.last_interaction || null },
          application_status: appStatus,
        }),
      })
      const data = await res.json() as { ok: boolean; draft?: ReferralDraftResult; message?: string }
      if (!data.ok || !data.draft) throw new Error(data.message ?? "Draft failed")
      setDraft(data.draft)
      setStep("result")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStep("form")
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div className="fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full">

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500">Referral outreach</p>
            <p className="mt-0.5 text-[14px] font-semibold text-slate-900 leading-tight">
              {jobTitle}
              <span className="font-normal text-slate-400"> at {companyName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Form ── */}
          {step === "form" && (
            <div className="space-y-5 p-5">
              {error && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-600">{error}</p>
              )}

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
                  Connection's name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sarah Kim"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
                  Their role at {companyName}
                </label>
                <input
                  type="text"
                  placeholder="e.g. Senior Engineer, Recruiter"
                  value={form.their_role_at_company}
                  onChange={e => setForm(f => ({ ...f, their_role_at_company: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
                  How do you know them? <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. worked together at Stripe 2021–2023 on the payments team"
                  value={form.relationship}
                  onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}
                  className="w-full resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
                  Relationship warmth
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {WARMTH_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, warmth: opt.value }))}
                      className={cn(
                        "flex flex-col rounded-xl border px-3 py-2.5 text-left transition",
                        form.warmth === opt.value
                          ? "border-orange-400 bg-orange-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <span className={cn(
                        "text-[12.5px] font-semibold",
                        form.warmth === opt.value ? "text-orange-600" : "text-slate-700"
                      )}>{opt.label}</span>
                      <span className="mt-0.5 text-[11px] text-slate-400">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
                  Last time you spoke <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. haven't spoken in ~2 years, or saw them last month"
                  value={form.last_interaction ?? ""}
                  onChange={e => setForm(f => ({ ...f, last_interaction: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 text-[12px] text-slate-500">
                <span className="font-semibold text-slate-600">Application status:</span>{" "}
                {appStatus}
              </div>
            </div>
          )}

          {/* ── Generating ── */}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-slate-100 border-t-orange-500" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-slate-900">Drafting your outreach…</p>
                <p className="mt-1 text-[12.5px] text-slate-400">Writing a message for {form.name}</p>
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {step === "result" && draft && (
            <div className="space-y-5 p-5">

              {/* Channel + tone note */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11.5px] font-semibold text-slate-600">
                  {draft.channel === "email"
                    ? <><Mail className="h-3 w-3" /> Email</>
                    : <><MessageSquare className="h-3 w-3" /> LinkedIn</>}
                </span>
                <span className="text-[11.5px] text-slate-400">{draft.tone_note}</span>
              </div>

              {/* Message to connection */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11.5px] font-semibold text-slate-500">Message to {form.name}</p>
                  <CopyButton text={draft.subject ? `Subject: ${draft.subject}\n\n${draft.message_to_connection}` : draft.message_to_connection} />
                </div>
                {draft.subject && (
                  <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                    <span className="font-semibold">Subject: </span>{draft.subject}
                  </div>
                )}
                <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-[1.75] text-slate-800">
                  {draft.message_to_connection}
                </div>
              </div>

              {/* Forwardable blurb */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-[11.5px] font-semibold text-slate-500">Forwardable blurb</p>
                    <p className="text-[11px] text-slate-400">{form.name} can paste this to the recruiter as-is</p>
                  </div>
                  <CopyButton text={draft.forwardable_blurb} />
                </div>
                <div className="whitespace-pre-wrap rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] leading-[1.75] text-slate-800">
                  {draft.forwardable_blurb}
                </div>
              </div>

              {applyUrl && (
                <a
                  href={applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-orange-500 hover:text-orange-400 transition"
                >
                  View job posting <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          {step === "form" && (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!form.name || !form.relationship}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-orange-400 disabled:opacity-50"
            >
              Generate outreach
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}

          {step === "result" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setStep("form"); setDraft(null) }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Edit & regenerate
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl bg-orange-500 py-2.5 text-[13px] font-bold text-white transition hover:bg-orange-400"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
