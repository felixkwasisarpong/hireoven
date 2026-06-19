"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Linkedin,
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

// ── Skeleton connection rows shown in idle state ──────────────────────────────

function SkeletonRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100 animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className={cn("h-3 rounded-full bg-slate-100 animate-pulse", width)} />
        <div className="h-2.5 w-28 rounded-full bg-slate-100 animate-pulse" />
      </div>
      <div className="h-5 w-8 rounded-full bg-slate-100 animate-pulse" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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
      void fetch("/api/apex/shadow-network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connections: msg.connections, jobTitle, companyName }),
      })
        .then((response) => {
          if (!response.ok) return
          window.dispatchEvent(new CustomEvent("hireoven:networking-contacts-updated", {
            detail: { jobId, companyName },
          }))
        })
        .catch(() => {})
      setStep("select")
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [companyName, jobId, jobTitle])

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  function scan() {
    setError(null)
    setStep("scanning")
    window.postMessage({ source: "hireoven-apex", type: "APEX_SCAN_CONNECTIONS", companyName, jobTitle }, window.location.origin)
    timeoutRef.current = setTimeout(() => {
      setError("Scan timed out. Make sure the extension is active and you're logged in to LinkedIn.")
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
      {/* Backdrop — solid enough to feel intentional */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal — centered, auto-height, max 90vh */}
      <div className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh] mx-4">

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500">Referral outreach</p>
            <p className="mt-0.5 text-[15px] font-semibold leading-snug text-slate-900">
              {jobTitle}
            </p>
            <p className="text-[13px] text-slate-400">at {companyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Idle */}
          {step === "idle" && (
            <>
              {/* LinkedIn hero strip */}
              <div className="bg-[#0A66C2] px-5 py-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Linkedin className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-white">Find your connections</p>
                    <p className="text-[12.5px] text-white/70">
                      Search your network for people at {companyName}
                    </p>
                  </div>
                </div>

                {isExtensionConnected ? (
                  <button
                    type="button"
                    onClick={scan}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-[13.5px] font-bold text-[#0A66C2] shadow transition hover:bg-white/90 active:scale-[0.98]"
                  >
                    <Linkedin className="h-4 w-4" />
                    Find connections at {companyName}
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl bg-white/10 px-4 py-3">
                    <p className="text-[13px] font-semibold text-white">Extension not detected</p>
                    <p className="mt-0.5 text-[12px] text-white/70">
                      Install the Hireoven extension to scan your LinkedIn network.
                    </p>
                  </div>
                )}

                {error && (
                  <p className="mt-3 rounded-xl bg-red-500/20 px-4 py-2.5 text-[12.5px] text-white">
                    {error}
                  </p>
                )}
              </div>

              {/* Skeleton preview rows */}
              <div className="divide-y divide-slate-50 border-b border-slate-100">
                <SkeletonRow width="w-36" />
                <SkeletonRow width="w-44" />
                <SkeletonRow width="w-32" />
              </div>

              <p className="px-5 py-3 text-center text-[11.5px] text-slate-400">
                Your 1st and 2nd degree connections will appear here
              </p>
            </>
          )}

          {/* Scanning */}
          {step === "scanning" && (
            <>
              <div className="bg-[#0A66C2] px-5 py-6">
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0">
                    <div className="absolute inset-0 animate-spin rounded-xl border-[3px] border-white/20 border-t-white" />
                    <div className="absolute inset-[5px] flex items-center justify-center">
                      <Linkedin className="h-4 w-4 text-white" />
                    </div>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-white">Scanning LinkedIn…</p>
                    <p className="text-[12.5px] text-white/70">Finding your connections at {companyName}</p>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-50 border-b border-slate-100">
                <SkeletonRow width="w-36" />
                <SkeletonRow width="w-44" />
                <SkeletonRow width="w-32" />
                <SkeletonRow width="w-40" />
              </div>
            </>
          )}

          {/* Select */}
          {step === "select" && (
            <>
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                <p className="text-[12px] font-semibold text-slate-500">
                  {connections.length} connection{connections.length !== 1 ? "s" : ""} found · tap one to draft your message
                </p>
              </div>
              {error && (
                <p className="border-b border-red-100 bg-red-50 px-5 py-3 text-[12.5px] text-red-600">
                  {error}
                </p>
              )}
              <div className="divide-y divide-slate-50">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void generate(c)}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2]/20 to-[#0A66C2]/10 text-[14px] font-bold text-[#0A66C2]">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[13.5px] font-semibold text-slate-900 truncate">{c.name}</p>
                        <span className={degreeBadge(c.degree)}>{degreeLabel(c.degree)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-slate-500 truncate">{c.title}</p>
                      {c.mutualCount > 0 && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          <Users className="inline h-3 w-3 mr-0.5 -mt-px" />
                          {c.mutualCount} mutual
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Generating */}
          {step === "generating" && selected && (
            <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-50">
                <div className="relative h-8 w-8">
                  <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-orange-100 border-t-orange-500" />
                </div>
              </div>
              <div>
                <p className="text-[15px] font-semibold text-slate-900">Writing your outreach…</p>
                <p className="mt-1 text-[12.5px] text-slate-400">Crafting a message for {selected.name}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {step === "result" && draft && selected && (
            <div className="space-y-5 p-5">
              {/* Connection chip */}
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2]/20 to-[#0A66C2]/10 text-[13px] font-bold text-[#0A66C2]">
                  {selected.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-900">{selected.name}</p>
                  <p className="text-[11.5px] text-slate-500 truncate">{selected.title}</p>
                </div>
                <span className={cn("ml-auto shrink-0", degreeBadge(selected.degree))}>
                  {degreeLabel(selected.degree)}
                </span>
              </div>

              {/* Channel tag */}
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
                    <p className="text-[11px] text-slate-400">{selected.name} pastes this to the recruiter</p>
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

        {/* ── Footer ────────────────────────────────────────────── */}
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
