"use client"

import { useEffect, useState } from "react"
import { Zap, ShieldCheck, Loader2, Play, Check } from "lucide-react"
import { cn } from "@/lib/utils"

type Criteria = {
  minMatchScore: number
  dailyCap: number
  requireSponsorship: boolean
  generateCoverLetter: boolean
  remoteOnly: boolean
}

type Props = {
  /** Fire a follow-up command into the Apex command bar (e.g. to launch bulk apply) */
  onFollowUp?: (command: string) => void
  extensionConnected?: boolean
  className?: string
}

const STORE_KEY = "hireoven:apex-auto-apply:v1"

const DEFAULTS: Criteria = {
  minMatchScore: 85,
  dailyCap: 5,
  requireSponsorship: false,
  generateCoverLetter: true,
  remoteOnly: false,
}

function readPrefs(): { enabled: boolean; criteria: Criteria } {
  if (typeof window === "undefined") return { enabled: false, criteria: DEFAULTS }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { enabled: false, criteria: DEFAULTS }
}

function writePrefs(prefs: { enabled: boolean; criteria: Criteria }) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
}

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:border-slate-200"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800">{label}</p>
        {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
      </div>
      <span className={cn(
        "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors",
        on ? "bg-slate-600" : "bg-slate-300"
      )}>
        <span className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-4" : "translate-x-0.5"
        )} />
      </span>
    </button>
  )
}

export function AutoApplyPanel({ onFollowUp, extensionConnected = false, className }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [criteria, setCriteria] = useState<Criteria>(DEFAULTS)
  const [savedFlash, setSavedFlash] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Load saved prefs after hydration
  useEffect(() => {
    const p = readPrefs()
    setEnabled(p.enabled)
    setCriteria({ ...DEFAULTS, ...p.criteria })
    setMounted(true)
  }, [])

  // Persist on change (after initial load)
  useEffect(() => {
    if (!mounted) return
    writePrefs({ enabled, criteria })
    setSavedFlash(true)
    const t = setTimeout(() => setSavedFlash(false), 1500)
    return () => clearTimeout(t)
  }, [enabled, criteria, mounted])

  const set = <K extends keyof Criteria>(key: K) => (v: Criteria[K]) =>
    setCriteria((c) => ({ ...c, [key]: v }))

  function runNow() {
    setLaunching(true)
    // Hand off to the existing supervised bulk-apply flow. The phrasing must
    // match BULK_PREP_RE on both client and server: "apply to … N <jobs>".
    // The noun MUST be jobs/roles/positions (not "matches") or routing breaks.
    let cmd = `Apply to my top ${criteria.dailyCap}`
    if (criteria.remoteOnly) cmd += " remote"
    cmd += " jobs"
    if (criteria.minMatchScore) cmd += ` with match score over ${criteria.minMatchScore}`
    if (criteria.requireSponsorship) cmd += " that sponsor H-1B"
    onFollowUp?.(cmd)
    setTimeout(() => setLaunching(false), 800)
  }

  return (
    <div className={cn("rounded-2xl border border-slate-100 bg-white shadow-sm", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50">
          <Zap className="h-4 w-4 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-900">1-Click Apply</p>
          <p className="text-[11px] text-slate-500">Pre-approve criteria, Apex prepares applications for you</p>
        </div>
        {savedFlash && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* Master toggle */}
        <div className={cn(
          "rounded-xl border p-3.5 transition-colors",
          enabled ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-50"
        )}>
          <Toggle
            on={enabled}
            onChange={setEnabled}
            label={enabled ? "Auto-apply is ON" : "Auto-apply is OFF"}
            sub={enabled
              ? `Apex will prepare up to ${criteria.dailyCap} applications/day matching your criteria for your review.`
              : "Turn on to let Apex queue applications that match your rules."}
          />
        </div>

        {/* Criteria */}
        <div className="space-y-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Criteria</p>

          {/* Min match score */}
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-slate-800">Minimum match score</p>
              <span className="text-[13px] font-bold text-slate-600">{criteria.minMatchScore}%</span>
            </div>
            <input
              type="range" min={70} max={99} step={1}
              value={criteria.minMatchScore}
              onChange={(e) => set("minMatchScore")(parseInt(e.target.value))}
              className="mt-2 w-full accent-indigo-600"
            />
            <p className="mt-1 text-[11px] text-slate-500">Only apply to roles scoring at least this high.</p>
          </div>

          {/* Daily cap */}
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-slate-800">Daily limit</p>
              <span className="text-[13px] font-bold text-slate-600">{criteria.dailyCap}/day</span>
            </div>
            <input
              type="range" min={1} max={20} step={1}
              value={criteria.dailyCap}
              onChange={(e) => set("dailyCap")(parseInt(e.target.value))}
              className="mt-2 w-full accent-indigo-600"
            />
            <p className="mt-1 text-[11px] text-slate-500">Apex never exceeds this many applications per day.</p>
          </div>

          <Toggle on={criteria.requireSponsorship} onChange={set("requireSponsorship")}
            label="Visa-sponsoring roles only" sub="Skip jobs without a sponsorship signal" />
          <Toggle on={criteria.remoteOnly} onChange={set("remoteOnly")}
            label="Remote only" sub="Skip on-site and hybrid roles" />
          <Toggle on={criteria.generateCoverLetter} onChange={set("generateCoverLetter")}
            label="Generate a cover letter for each" sub="Tailored per role before review" />
        </div>

        {/* Safety note */}
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
          <p className="text-[11.5px] leading-relaxed text-emerald-800">
            <span className="font-semibold">You stay in control.</span> Apex prepares and queues applications matching your rules, but you review and approve each batch before anything is submitted. Sensitive fields (work authorization, demographics) are never auto-filled.
          </p>
        </div>

        {/* Run now */}
        <button
          type="button"
          onClick={runNow}
          disabled={launching}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-[13px] font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {launching ? "Finding your top matches…" : `Prepare my top ${criteria.dailyCap} matches now`}
        </button>

        {!extensionConnected && (
          <p className="text-center text-[11px] text-amber-600">
            Tip: install the Apex browser extension so Apex can autofill the application forms for you.
          </p>
        )}
      </div>
    </div>
  )
}
