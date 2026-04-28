"use client"

import {
  Check,
  Clock,
  Copy,
  Loader2,
  Lock,
  MessageCircle,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { analyzeFollowUp, urgencyMeta } from "@/lib/scout/follow-up"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { JobApplication } from "@/types"

type APIResponse = {
  status: string
  recommendation: string
  reasons: string[]
  daysStale: number | null
  urgency: string | null
  draft?: string | null
  gated?: boolean
  error?: string
}

type Props = {
  app: JobApplication
}

export function ScoutFollowUpBlock({ app }: Props) {
  const { showUpgrade } = useUpgradeModal()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftGated, setDraftGated] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Run deterministic analysis client-side — instant, no loading state needed
  const analysis = analyzeFollowUp(app)

  // Don't render anything for terminal statuses or missing context
  if (analysis.status === "not_needed" || analysis.status === "missing_context") {
    return null
  }

  const um = urgencyMeta(analysis.urgency)

  async function generateDraft() {
    setIsGenerating(true)
    setDraftError(null)
    setDraft(null)
    setDraftGated(false)

    try {
      const res = await fetch("/api/scout/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: app.id }),
      })
      const data = (await res.json().catch(() => null)) as APIResponse | null

      if (!res.ok || !data) {
        setDraftError("Couldn't generate draft right now. Try again.")
        return
      }

      if (data.gated) {
        setDraftGated(true)
        return
      }

      setDraft(data.draft ?? null)
      if (!data.draft) {
        setDraftError("Draft generation failed. Try again.")
      }
    } catch {
      setDraftError("Network error. Check your connection.")
    } finally {
      setIsGenerating(false)
    }
  }

  async function copyDraft() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed silently
    }
  }

  return (
    <div className="rounded-[12px] border border-slate-200/80 bg-slate-50/60">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3.5 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <div className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#ea580c]">
            <MessageCircle className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-slate-900">Scout: Follow-up advice</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10.5px] font-semibold",
              um.badge
            )}
          >
            {um.label}
          </span>
          <span className="text-[10px] text-slate-400">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-slate-200/70 px-3.5 pb-4 pt-3 space-y-3.5">
          {/* Timing chip */}
          {analysis.daysStale !== null && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" />
              {analysis.daysStale === 0
                ? "Activity recorded today"
                : `Last activity ${analysis.daysStale} day${analysis.daysStale === 1 ? "" : "s"} ago`}
            </div>
          )}

          {/* Recommendation */}
          <p className="text-[13px] leading-5 text-slate-800">{analysis.recommendation}</p>

          {/* Reasons */}
          {analysis.reasons.length > 0 && (
            <ul className="space-y-1">
              {analysis.reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                  {reason}
                </li>
              ))}
            </ul>
          )}

          {/* Draft section */}
          {!draft && !draftGated && (
            <button
              type="button"
              onClick={generateDraft}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-[#ea580c]/20 hover:bg-[#ea580c]/5 hover:text-[#ea580c] disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isGenerating ? "Drafting…" : "Generate follow-up draft"}
            </button>
          )}

          {draftError && (
            <p className="text-[11.5px] text-red-600">{draftError}</p>
          )}

          {draftGated && (
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 flex-shrink-0 text-amber-700" />
                <p className="text-[12px] font-semibold text-amber-900">
                  Pro feature
                </p>
              </div>
              <p className="mt-1 text-[11.5px] leading-4 text-amber-800">
                Upgrade to Scout Pro to generate AI-drafted follow-up messages.
              </p>
              <button
                type="button"
                onClick={() => showUpgrade("interview_prep")}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-amber-700"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade to Pro
              </button>
            </div>
          )}

          {draft && (
            <div className="space-y-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Draft
              </p>
              <div className="rounded-[10px] border border-slate-200 bg-white px-3.5 py-3">
                <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-slate-800">
                  {draft}
                </p>
              </div>
              <button
                type="button"
                onClick={copyDraft}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy to clipboard
                  </>
                )}
              </button>
              <p className="text-[10.5px] text-slate-400">
                Review before sending. Scout does not email on your behalf.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
