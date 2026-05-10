"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { CreditCard, Lock } from "lucide-react"
import PersonaPicker, { type PersonaId } from "@/components/interview/PersonaPicker"
import { useToast } from "@/components/ui/ToastProvider"
import { useSubscription } from "@/lib/context/SubscriptionContext"
import { cn } from "@/lib/utils"

type InterviewType = "text" | "live" | "coding"
type QuestionSet = "behavioral" | "technical_screen" | "system_design" | "mixed"
type Duration = 15 | 30

type SavedJob = {
  id: string
  job_id: string | null
  job_title: string
  company_name: string
  status: string
}

const TYPE_OPTIONS: { id: InterviewType; label: string }[] = [
  { id: "text",   label: "Text" },
  { id: "live",   label: "Live" },
  { id: "coding", label: "Coding" },
]

const QUESTION_SET_OPTIONS: { id: QuestionSet; label: string }[] = [
  { id: "behavioral",      label: "Behavioral" },
  { id: "technical_screen", label: "Technical screen" },
  { id: "system_design",   label: "System design" },
  { id: "mixed",           label: "Mixed" },
]

const DURATION_OPTIONS: Duration[] = [15, 30]

type Props = {
  initialType?: InterviewType
  initialJobId?: string
}

export default function SetupForm({ initialType, initialJobId }: Props) {
  const router = useRouter()
  const { pushToast } = useToast()

  const { isPro, isProMax, isLoading: subLoading } = useSubscription()

  const [type, setType] = useState<InterviewType>(initialType ?? "text")
  const [jobId, setJobId] = useState<string>(initialJobId ?? "")
  const [persona, setPersona] = useState<PersonaId>("friendly_recruiter")
  const [questionSet, setQuestionSet] = useState<QuestionSet>("behavioral")
  const [duration, setDuration] = useState<Duration>(30)
  const [useResume, setUseResume] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [jobs, setJobs] = useState<SavedJob[]>([])

  // Credits — only fetched when Pro Max and live mode selected
  const [credits, setCredits] = useState<{ balance: number; costs: { short: number } } | null>(null)
  const [buyingCredits, setBuyingCredits] = useState(false)

  useEffect(() => {
    if (type !== "live") return
    fetch("/api/interview/credits/balance")
      .then((r) => r.json())
      .then((d) => setCredits({ balance: d.balance ?? 0, costs: d.costs ?? { short: 1 } }))
      .catch(() => {})
  }, [type])

  async function buyCredits(pack: string) {
    setBuyingCredits(true)
    try {
      const res = await fetch("/api/interview/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setBuyingCredits(false)
    }
  }

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then((d) => {
        const all = (d.applications ?? []) as SavedJob[]
        setJobs(
          all.filter(
            (j) =>
              j.job_id &&
              !["rejected", "withdrawn"].includes(j.status)
          )
        )
      })
      .catch(() => {})
  }, [])

  // Reset persona away from panel when switching to non-live mode
  useEffect(() => {
    if (type !== "live" && persona === "panel") setPersona("friendly_recruiter")
  }, [type, persona])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    const opensInNewTab = type === "live" || type === "coding"
    const preOpenedTab = opensInNewTab && typeof window !== "undefined"
      ? window.open("", "_blank")
      : null
    if (preOpenedTab) {
      preOpenedTab.opener = null
    }

    try {
      const res = await fetch("/api/interview/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: jobId || null,
          type,
          persona,
          questionSet: type === "coding" ? "coding" : questionSet,
          durationTargetMin: duration,
          useResumeContext: useResume,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        preOpenedTab?.close()
        pushToast({ tone: "error", title: data.error ?? "Failed to create session" })
        return
      }

      if (opensInNewTab && preOpenedTab) {
        preOpenedTab.location.href = data.redirectTo
        preOpenedTab.focus()
        router.push("/dashboard/interview")
        return
      }

      if (opensInNewTab && !preOpenedTab) {
        pushToast({
          tone: "info",
          title: "Popup blocked — opening interview in this tab.",
        })
      }

      router.push(data.redirectTo)
    } catch {
      preOpenedTab?.close()
      pushToast({ tone: "error", title: "Network error — please try again" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const pageTitle = !initialType
    ? "Set up your interview"
    : type === "coding"
      ? "Set up your live coding test"
      : type === "live"
        ? "Set up your live interview"
        : "Set up your text interview"

  // ── Plan + credit gates ──────────────────────────────────────────────────
  if (!subLoading) {
    // Text / coding require Pro
    if ((type === "text" || type === "coding") && !isPro) {
      return (
        <div className="space-y-4">
          <Link href="/dashboard/interview" className="text-[13px] font-medium text-slate-500 hover:text-slate-700">
            ← Back to interview hub
          </Link>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Lock className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h2 className="text-[16px] font-bold text-slate-900">
              {type === "coding" ? "Coding Test" : "Text Interview"} requires Pro
            </h2>
            <p className="mt-2 text-[13px] text-slate-500">
              Upgrade to Pro to unlock AI interviews with real debriefs.
            </p>
            <Link
              href="/dashboard/upgrade?plan=pro"
              className="mt-5 inline-flex rounded-lg bg-orange-500 px-6 py-2.5 text-[14px] font-semibold text-white hover:bg-orange-600"
            >
              Upgrade to Pro — $19/mo
            </Link>
          </div>
        </div>
      )
    }

    // Live requires credits
    if (type === "live" && credits !== null) {
      const needed = credits.costs.short ?? 1
      if (credits.balance < needed) {
        return (
          <div className="space-y-4">
            <Link href="/dashboard/interview" className="text-[13px] font-medium text-slate-500 hover:text-slate-700">
              ← Back to interview hub
            </Link>
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <CreditCard className="mx-auto mb-3 h-8 w-8 text-orange-400" />
              <h2 className="text-[16px] font-bold text-slate-900">Not enough credits</h2>
              <p className="mt-2 text-[13px] text-slate-500">
                You have <strong>{credits.balance}</strong> credits.
                A {duration}-min session costs <strong>{needed}</strong>.
                Buy a credit pack to continue.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 max-w-xs mx-auto">
                {[
                  { pack: "session_short_1", label: "1 session",  price: "30 min — $12" },
                  { pack: "session_short_3", label: "3 sessions", price: "3×30 min — $30" },
                ].map(({ pack, label, price }) => (
                  <button
                    key={pack}
                    type="button"
                    disabled={buyingCredits}
                    onClick={() => buyCredits(pack)}
                    className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[13px] font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-60"
                  >
                    {label}<br />
                    <span className="text-[11px] font-normal">{price}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      }
    }
  }
  // ── End gates ──────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/interview"
          className="text-[13px] font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to interview hub
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{pageTitle}</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Configure your session below. You can always change these later.
        </p>
      </div>

      {/* Mode picker — only shown if type was not preset via URL */}
      {!initialType && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-slate-700">Mode</legend>
          <div className="flex gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setType(opt.id)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-[13px] font-medium transition",
                  type === opt.id
                    ? "border-orange-300 bg-orange-50 text-orange-700 ring-1 ring-orange-300"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Target role */}
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-slate-700">Target role</legend>
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-300"
        >
          <option value="">Generic / no specific job</option>
          {jobs.map((j) => (
            <option key={j.job_id} value={j.job_id!}>
              {j.job_title} @ {j.company_name}
            </option>
          ))}
        </select>
      </fieldset>

      {/* Question set — hidden for coding type */}
      {type !== "coding" && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-slate-700">Question set</legend>
          <div className="flex flex-wrap gap-2">
            {QUESTION_SET_OPTIONS.map((opt) => (
              <label key={opt.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="questionSet"
                  value={opt.id}
                  checked={questionSet === opt.id}
                  onChange={() => setQuestionSet(opt.id)}
                  className="accent-orange-500"
                />
                <span className="text-[13px] text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Persona */}
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-slate-700">Interviewer persona</legend>
        <PersonaPicker value={persona} onChange={setPersona} interviewType={type} />
      </fieldset>

      {/* Duration */}
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-slate-700">Duration</legend>
        <div className="flex gap-2">
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={cn(
                "rounded-lg border px-4 py-2 text-[13px] font-medium transition",
                duration === d
                  ? "border-orange-300 bg-orange-50 text-orange-700 ring-1 ring-orange-300"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {d} min
            </button>
          ))}
        </div>
      </fieldset>

      {/* Resume context toggle */}
      <fieldset>
        <div className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4">
          <div className="mr-4">
            <p className="text-[13px] font-semibold text-slate-900">Use my resume context</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              When on, the interviewer references your real experience instead of asking generic questions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUseResume((v) => !v)}
            role="switch"
            aria-checked={useResume}
            className={cn(
              "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
              useResume ? "bg-orange-500" : "bg-slate-200"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                useResume ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      </fieldset>

      {/* Credits notice for live sessions */}
      {type === "live" && credits !== null && (
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-[13px]">
          <span className="text-slate-600">
            This session will use{" "}
            <strong>{credits.costs.short} credits</strong>
          </span>
          <span className="font-semibold text-slate-900">
            Balance: {credits.balance} cr
          </span>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-orange-500 px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
      >
        {isSubmitting
          ? "Starting…"
          : type === "coding"
            ? "Start live coding test"
            : "Start interview"}
      </button>
    </form>
  )
}
