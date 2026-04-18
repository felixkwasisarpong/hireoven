"use client"

import { useState } from "react"
import { Loader2, Plus, X } from "lucide-react"
import type { ApplicationStatus } from "@/types"

type Props = {
  onClose: () => void
  onAdd: (payload: {
    companyName: string
    jobTitle: string
    status: ApplicationStatus
    applyUrl?: string
    notes?: string
  }) => Promise<void>
  defaultStatus?: ApplicationStatus
}

const STATUS_OPTIONS: { value: ApplicationStatus; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "phone_screen", label: "Phone Screen" },
  { value: "interview", label: "Interview" },
  { value: "final_round", label: "Final Round" },
  { value: "offer", label: "Offer" },
]

export function AddApplicationModal({ onClose, onAdd, defaultStatus = "saved" }: Props) {
  const [companyName, setCompanyName] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [status, setStatus] = useState<ApplicationStatus>(defaultStatus)
  const [applyUrl, setApplyUrl] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim() || !jobTitle.trim()) {
      setError("Company name and job title are required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onAdd({
        companyName: companyName.trim(),
        jobTitle: jobTitle.trim(),
        status,
        applyUrl: applyUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      onClose()
    } catch (e: any) {
      setError(e.message ?? "Failed to add application")
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-[20px] bg-white shadow-2xl border border-slate-200/60"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200/70">
            <p className="font-semibold text-slate-900">Add application</p>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Company <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Stripe"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Job title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Software Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  required
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 focus:outline-none"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Job URL
                </label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={applyUrl}
                  onChange={(e) => setApplyUrl(e.target.value)}
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Any early notes…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full resize-none rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#FF5C18] py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {saving ? "Adding…" : "Add application"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-[10px] border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
