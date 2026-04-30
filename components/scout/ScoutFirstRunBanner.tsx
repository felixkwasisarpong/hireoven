"use client"

/**
 * ScoutFirstRunBanner — shown once on first visit to Scout OS.
 *
 * Progressive onboarding: surfaces core value props and safety copy
 * immediately, without blocking the user from starting. Dismissed
 * either explicitly (×) or automatically after the first command.
 *
 * No walls. No required steps. Command-first.
 */

import { ArrowRight, Shield, Sparkles, X } from "lucide-react"

type Props = {
  firstName: string
  onDismiss: () => void
  onTileClick: (query: string) => void
}

const STARTER_PROMPTS = [
  "Find remote backend jobs with H-1B sponsorship",
  "Research sponsorship-friendly tech companies",
  "What can Scout do for my job search?",
  "Help me prepare for a technical interview",
]

export function ScoutFirstRunBanner({ firstName, onDismiss, onTileClick }: Props) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-[#FF5C18]/20 bg-gradient-to-br from-slate-950 to-slate-900 text-white shadow-[0_8px_32px_rgba(255,92,24,0.12)]">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.5)]">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#FF5C18]">
              Scout workspace
            </p>
            <h2 className="mt-1 text-xl font-bold leading-tight tracking-tight text-white">
              {firstName !== "there" ? `Welcome, ${firstName}.` : "Welcome to Scout."}
            </h2>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-400">
              Your AI job search operating system — finds opportunities, prepares applications, and researches companies. You stay in control.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss welcome"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Capability pills ──────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap gap-2 px-6">
        {[
          "Job search & filtering",
          "Resume tailoring",
          "Company research",
          "Interview prep",
          "Application workflows",
          "Recruiter outreach",
        ].map((cap) => (
          <span
            key={cap}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-300"
          >
            {cap}
          </span>
        ))}
      </div>

      {/* ── Starter prompts ───────────────────────────────────────── */}
      <div className="mt-5 border-t border-white/8 px-6 pb-5 pt-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Try a command to start
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onTileClick(prompt)}
              className="group flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3.5 py-2.5 text-left text-[12px] font-medium text-slate-300 transition hover:border-[#FF5C18]/30 hover:bg-[#FF5C18]/8 hover:text-white"
            >
              <span className="flex-1 leading-snug">{prompt}</span>
              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-600 transition group-hover:text-[#FF5C18]" />
            </button>
          ))}
        </div>
      </div>

      {/* ── Safety footer ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-t border-white/8 px-6 py-3">
        <Shield className="h-3 w-3 flex-shrink-0 text-slate-600" />
        <p className="text-[10.5px] text-slate-600">
          Scout prepares. You approve. Nothing is submitted automatically.
        </p>
      </div>
    </div>
  )
}
