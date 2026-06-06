"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  MessageSquare,
  Users,
  X,
} from "lucide-react"
import { useActiveBrowserContext } from "@/lib/apex/browser-context"
import { cn } from "@/lib/utils"
import type { ReferralDraftResult } from "@/app/api/apex/referral-draft/route"
import type { ScannedConnection } from "@/chrome-extension/src/apex-connection-scanner"

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  applyUrl: string | null
  applicationStatus?: string
  onClose: () => void
}

type Step = "idle" | "scanning" | "select" | "generating" | "result"

const SCAN_TIMEOUT_MS = 30_000

function degreeWarmth(degree: 1 | 2 | 3): "high" | "medium" | "low" {
  if (degree === 1) return "high"
  if (degree === 2) return "medium"
  return "low"
}

function degreeLabel(degree: 1 | 2 | 3) {
  return degree === 1 ? "1st" : degree === 2 ? "2nd" : "3rd"
}

function degreeBadge(degree: 1 | 2 | 3) {
  return cn(
    "rounded-full px-2 py-0.5 text-[10px] font-bold",
    degree === 1 ? "bg-emerald-100 text-emerald-700" :
    degree === 2 ? "bg-blue-100 text-blue-700" :
    "bg-slate-100 text-slate-500"
  )
}

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
  const { isExtensionConnected } = useActiveBrowserContext()
  const [step, setStep] = useState<Step>("idle")
  const [connections, setConnections] = useState<ScannedConnection[]>([])
  const [selected, setSelected] = useState<ScannedConnection | null>(null)
  const [draft, setDraft] = useState<ReferralDraftResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appStatus = applicationStatus ?? "not yet applied"

  // Listen for scan result from extension
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const msg = e.data as { type?: string; ok?: boolean; connections?: ScannedConnection[]; error?: string }
      if (msg.type !== "APEX_SCAN_CONNECTIONS_RESULT") return
      if (timeoutRef.current) clearTimeout(timeoutRef.current)

      if (!msg.ok || !msg.connections?.length) {
        setError(msg.error ?? "No connections found at this company on LinkedIn.")
        setStep("idle")
        return
      }
      setConnections(msg.connections)
      setStep("select")
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  function scan() {
    setError(null)
    setStep("scanning")
    window.postMessage({ type: "APEX_SCAN_CONNECTIONS", companyName, jobTitle }, window.location.origin)
    timeoutRef.current = setTimeout(() => {
      setError("LinkedIn scan timed out. Make sure the extension is active and you're logged in to LinkedIn.")
      setStep("idle")
    }, SCAN_TIMEOUT_MS)
  }

  const generate = useCallback(async (connection: ScannedConnection) => {
    setSelected(connection)
    setStep("generating")
    setError(null)

    const warmth = degreeWarmth(connection.degree)
    const relationship = connection.degree === 1
      ? "direct LinkedIn connection"
      : `${connection.mutualCount > 0 ? `${connection.mutualCount} mutual connections` : "2nd-degree LinkedIn connection"}`

    try {
      const res = await fetch("/api/apex/referral-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          connection: {
            name: connection.name,
            their_role_at_company: connection.title,
            relationship,
            warmth,
            last_interaction: connection.recentlyActive ? "recently active on LinkedIn" : null,
          },
          application_status: appStatus,
        }),
      })
      const data = await res.json() as { ok: boolean; draft?: ReferralDraftResult; message?: string }
      if (!data.ok || !data.draft) throw new Error(data.message ?? "Draft failed")
      setDraft(data.draft)
      setStep("result")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStep("select")
    }
  }, [jobId, appStatus])

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

          {/* ── Idle: find connections ── */}
          {step === "idle" && (
            <div className="flex flex-col items-center justify-center gap-5 px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A66C2]/10">
                <Linkedin className="h-6 w-6 text-[#0A66C2]" />
              </div>
              <div>
                <p className="text-[16px] font-semibold text-slate-900">Find your connections</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                  We'll search your LinkedIn network for people at {companyName} who could refer you.
                </p>
              </div>

              {error && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-[12.5px] text-red-600 text-left w-full">{error}</p>
              )}

              {isExtensionConnected ? (
                <button
                  type="button"
                  onClick={scan}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0A66C2] px-6 py-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#0958a8]"
                >
                  <Linkedin className="h-4 w-4" />
                  Find connections at {companyName}
                </button>
              ) : (
                <div className="rounded-xl bg-slate-50 px-5 py-4 text-center">
                  <p className="text-[13px] font-semibold text-slate-700">Extension not detected</p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Install the Hireoven extension to scan your LinkedIn network.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Scanning ── */}
          {step === "scanning" && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-slate-100 border-t-[#0A66C2]" />
                <div className="absolute inset-[5px] flex items-center justify-center">
                  <Linkedin className="h-4 w-4 text-[#0A66C2]" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-slate-900">Scanning LinkedIn…</p>
                <p className="mt-1 text-[12.5px] text-slate-400">Finding your connections at {companyName}</p>
              </div>
            </div>
          )}

          {/* ── Select connection ── */}
          {step === "select" && (
            <div className="flex flex-col">
              <div className="border-b border-slate-100 px-5 py-3">
                <p className="text-[12px] font-semibold text-slate-500">
                  {connections.length} connection{connections.length !== 1 ? "s" : ""} found · click one to draft your message
                </p>
              </div>
              <div className="divide-y divide-slate-50">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void generate(c)}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                  >
                    {/* Avatar placeholder */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-[14px] font-bold text-slate-600">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-slate-900 truncate">{c.name}</p>
                        <span className={degreeBadge(c.degree)}>{degreeLabel(c.degree)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-slate-500 truncate">{c.title}</p>
                      {c.mutualCount > 0 && (
                        <p className="mt-0.5 text-[11.5px] text-slate-400">
                          <Users className="inline h-3 w-3 mr-0.5" />
                          {c.mutualCount} mutual
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Generating ── */}
          {step === "generating" && selected && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-slate-100 border-t-orange-500" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-slate-900">Writing your outreach…</p>
                <p className="mt-1 text-[12.5px] text-slate-400">Crafting a message for {selected.name}</p>
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {step === "result" && draft && selected && (
            <div className="space-y-5 p-5">

              {/* Who this is for */}
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-[13px] font-bold text-slate-600">
                  {selected.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900">{selected.name}</p>
                  <p className="text-[11.5px] text-slate-500 truncate">{selected.title}</p>
                </div>
                <span className={cn("ml-auto shrink-0", degreeBadge(selected.degree))}>
                  {degreeLabel(selected.degree)}
                </span>
              </div>

              {/* Channel + tone */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11.5px] font-semibold text-slate-600">
                  {draft.channel === "email"
                    ? <><Mail className="h-3 w-3" /> Email</>
                    : <><MessageSquare className="h-3 w-3" /> LinkedIn</>}
                </span>
                <span className="text-[11.5px] text-slate-400">{draft.tone_note}</span>
              </div>

              {/* Message */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11.5px] font-semibold text-slate-500">Message to {selected.name}</p>
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
                    <p className="text-[11px] text-slate-400">{selected.name} can paste this to the recruiter as-is</p>
                  </div>
                  <CopyButton text={draft.forwardable_blurb} />
                </div>
                <div className="whitespace-pre-wrap rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] leading-[1.75] text-slate-800">
                  {draft.forwardable_blurb}
                </div>
              </div>

              {applyUrl && (
                <a href={applyUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 text-[12px] font-medium text-orange-500 hover:text-orange-400 transition">
                  View job posting <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {error && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-[12.5px] text-red-600">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          {(step === "idle" || step === "scanning") && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          )}

          {step === "select" && (
            <button
              type="button"
              onClick={() => { setStep("idle"); setConnections([]) }}
              className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              ← Search again
            </button>
          )}

          {step === "result" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setStep("select"); setDraft(null); setSelected(null) }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Pick another
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
