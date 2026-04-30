"use client"

import { useCallback, useRef, useState } from "react"
import { AlertTriangle, ArrowUpRight, Check, Copy, Lightbulb, Mail, MessageSquare, RefreshCw, Reply, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { getScoutDisplayText } from "@/lib/scout/display-text"
import {
  OUTREACH_TYPE_LABELS,
  OUTREACH_TONE_LABELS,
  OUTREACH_CHAR_LIMITS,
} from "@/lib/scout/outreach/types"
import type { ScoutOutreachDraft, ScoutOutreachType } from "@/lib/scout/outreach/types"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"

// ── Type icons ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ScoutOutreachType, React.ElementType> = {
  linkedin_message: MessageSquare,
  email:            Mail,
  follow_up:        Reply,
  referral_request: Users,
}

// ── Refine chips ──────────────────────────────────────────────────────────────

const REFINE_CHIPS = [
  "Make it more concise",
  "Use a warmer tone",
  "Add more technical detail",
  "Remove any fluff",
  "Prepare a follow-up version",
]

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-950 text-white hover:bg-slate-800"
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy to clipboard"}
    </button>
  )
}

// ── Character counter ─────────────────────────────────────────────────────────

function CharCounter({ count, limit }: { count: number; limit: number }) {
  const pct = count / limit
  return (
    <span className={cn(
      "text-[10px] tabular-nums",
      pct > 0.9 ? "text-red-500" : pct > 0.75 ? "text-amber-500" : "text-slate-400",
    )}>
      {count} / {limit}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  response:       ScoutResponse
  onFollowUp:     (query: string) => void
  activeEntities?: ActiveEntities
}

export function OutreachMode({ response, onFollowUp, activeEntities }: Props) {
  const outreach = response.outreach
  const [draft, setDraft] = useState(outreach?.draft ?? "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const outreachType  = outreach?.type ?? "linkedin_message"
  const charLimit     = OUTREACH_CHAR_LIMITS[outreachType]
  const Icon          = TYPE_ICONS[outreachType]
  const typeLabel     = OUTREACH_TYPE_LABELS[outreachType]
  const toneLabel     = outreach?.tone ? OUTREACH_TONE_LABELS[outreach.tone] : null
  const answerText    = getScoutDisplayText(response.answer)

  // ── Context from workspace_directive payload ─────────────────────────────────
  const wdPayload = response.workspace_directive?.mode === "outreach"
    ? (response.workspace_directive.payload ?? {})
    : {}

  const companyName = (wdPayload.companyName as string | undefined) ?? activeEntities?.companyName
  const jobTitle    = (wdPayload.jobTitle    as string | undefined) ?? activeEntities?.jobTitle

  // No outreach draft was generated (Claude didn't produce the field)
  if (!outreach) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-5">
          <p className="text-sm font-semibold text-gray-900">Outreach</p>
          <p className="mt-2 text-sm text-gray-500">
            Scout couldn't generate a draft. Try giving more context — mention the company, role, and recipient type.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Draft a LinkedIn message for this role", "Write a follow-up email after applying", "Help me contact the hiring manager"].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onFollowUp(chip)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_220px]">

      {/* ── Left: draft editor ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

          {/* Header */}
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
              <Icon className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">{typeLabel}</p>
                {toneLabel && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {toneLabel}
                  </span>
                )}
              </div>
              {(companyName || jobTitle) && (
                <p className="mt-0.5 truncate text-[11px] text-gray-400">
                  {jobTitle ?? ""}
                  {jobTitle && companyName ? " at " : ""}
                  {companyName ?? ""}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onFollowUp(`Regenerate this ${typeLabel.toLowerCase()}`)}
              title="Regenerate draft"
              className="flex-shrink-0 text-slate-400 transition hover:text-[#FF5C18]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Editable draft */}
          <div className="px-5 py-4">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-800 transition focus:border-slate-400 focus:bg-white focus:outline-none"
                placeholder="Your draft will appear here…"
                spellCheck
              />
              <div className="mt-1.5 flex items-center justify-end">
                <CharCounter count={draft.length} limit={charLimit} />
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center gap-3">
              <CopyButton text={draft} />
              <p className="text-[10px] text-gray-400">
                Edit directly above · Scout never sends on your behalf
              </p>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {outreach.warnings && outreach.warnings.length > 0 && (
          <div className="flex flex-col gap-2">
            {outreach.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                <p className="text-xs text-amber-700">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Refine chips */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Refine</p>
          <div className="flex flex-wrap gap-2">
            {REFINE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onFollowUp(chip)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right: intelligence context ───────────────────────────────────── */}
      <div className="hidden space-y-5 lg:block">

        {/* Scout guidance */}
        {answerText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Scout Guidance
            </p>
            <p className="text-xs leading-5 text-gray-600">{answerText}</p>
          </div>
        )}

        {/* Talking points */}
        {outreach.talkingPoints && outreach.talkingPoints.length > 0 && (
          <div className={answerText ? "border-t border-gray-100 pt-4" : ""}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Talking Points
            </p>
            <ul className="space-y-2">
              {outreach.talkingPoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#FF5C18]" />
                  <span className="text-xs text-gray-600">{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Context sources badge */}
        {outreach.generatedFrom && (
          <div className={cn(
            (answerText || outreach.talkingPoints?.length) ? "border-t border-gray-100 pt-4" : ""
          )}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Generated From
            </p>
            <div className="flex flex-wrap gap-1">
              {outreach.generatedFrom.job          && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Job description</span>}
              {outreach.generatedFrom.resume        && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Your resume</span>}
              {outreach.generatedFrom.companyIntel  && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Company intel</span>}
            </div>
          </div>
        )}

        {/* Recipient context */}
        {(outreach.recipientName || outreach.recipientRole) && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Recipient
            </p>
            {outreach.recipientName && (
              <p className="text-sm font-semibold text-gray-800">{outreach.recipientName}</p>
            )}
            {outreach.recipientRole && (
              <p className="mt-0.5 text-xs text-gray-500">{outreach.recipientRole}</p>
            )}
          </div>
        )}

        {/* Reminder */}
        <div className="rounded-xl border border-dashed border-gray-200 px-3 py-3">
          <p className="text-[10px] leading-4 text-gray-400">
            Scout drafts are starting points. Edit to match your voice before sending.
            Scout never contacts anyone on your behalf.
          </p>
        </div>
      </div>
    </div>
  )
}
