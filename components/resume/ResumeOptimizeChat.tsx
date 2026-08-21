"use client"

/**
 * The guided résumé-optimisation conversation.
 *
 * What a person sees after uploading, in place of the old review panels. The
 * panels rendered a ranked diagnosis and left them to act on it; this asks the
 * two questions that change the output — which lane, which industry — and then
 * hands the answers to the existing fix engine.
 *
 * Deliberately not built on ApexMessageBubble: that component is typed to
 * ApexResponse and routes its content through ApexResponseRenderer, so reusing
 * it would mean dressing résumé content up as an Apex reply. Same visual
 * language, no false coupling.
 *
 * All sequencing lives in lib/resume/optimize-conversation.ts. This component
 * renders what `describe()` returns and feeds answers back through `advance()`,
 * which is why there is no branching logic here beyond presentation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Loader2, RotateCcw } from "lucide-react"
import { ApexIcon } from "@/components/apex/ApexIcon"
import ResumeFixFlow, { type FixPlanPayload } from "@/components/resume/ResumeFixFlow"
import {
  ANY_INDUSTRY,
  advance,
  describe,
  goBack,
  startConversation,
  type ConversationState,
} from "@/lib/resume/optimize-conversation"
import type { ResumeLane } from "@/lib/resume/lanes"

const BRAND = "#FF5C18"

type LanesResponse = {
  hasResume: boolean
  parseStatus?: string | null
  parseError?: string | null
  resume?: { id: string; name: string | null; fullName: string | null }
  grounded?: boolean
  lanes?: ResumeLane[]
  ambiguous?: boolean
}

type TargetResponse = {
  target?: { lane: ResumeLane; industry: string | null }
  fixPlan?: FixPlanPayload
  error?: string
}

/** Parsing can still be in flight when we land here straight from upload. */
const POLL_MS = 2000
const MAX_POLLS = 30

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <ApexIcon size={22} />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-[15px] leading-relaxed text-slate-700">
        {children}
      </div>
    </div>
  )
}

function Answer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-2.5 text-[14.5px] text-slate-800">
        {children}
      </div>
    </div>
  )
}

export default function ResumeOptimizeChat() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [waitingOnParse, setWaitingOnParse] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [freeText, setFreeText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [plan, setPlan] = useState<FixPlanPayload | null>(null)
  const [applied, setApplied] = useState(false)
  /** Answers already given, so the thread reads as a conversation. */
  const [transcript, setTranscript] = useState<string[]>([])

  const pollCount = useRef(0)

  const loadLanes = useCallback(async () => {
    const res = await fetch("/api/resume/optimize")
    if (!res.ok) throw new Error(`Could not read your résumé (${res.status})`)
    return (await res.json()) as LanesResponse
  }, [])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const data = await loadLanes()
        if (!alive) return

        if (!data.hasResume) {
          // Still parsing is normal immediately after upload; a parse error is not.
          if (data.parseError) {
            setError(data.parseError)
            setWaitingOnParse(false)
            setLoading(false)
            return
          }
          if (pollCount.current++ < MAX_POLLS) {
            setWaitingOnParse(true)
            timer = setTimeout(tick, POLL_MS)
            return
          }
          setError("Your résumé is taking longer than expected to process.")
          setWaitingOnParse(false)
          setLoading(false)
          return
        }

        setWaitingOnParse(false)
        setState(startConversation(data.lanes ?? [], Boolean(data.ambiguous)))
        setLoading(false)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : "Something went wrong.")
        setLoading(false)
      }
    }

    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [loadLanes])

  const view = useMemo(() => (state ? describe(state) : null), [state])

  const requestPlan = useCallback(async (laneKey: string, industry: string | null) => {
    setSubmitting(true)
    try {
      const res = await fetch("/api/resume/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laneKey, industry }),
      })
      const data = (await res.json()) as TargetResponse
      if (!res.ok) throw new Error(data.error ?? `Could not build a plan (${res.status})`)
      setPlan(data.fixPlan ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a plan.")
    } finally {
      setSubmitting(false)
    }
  }, [])

  const answer = useCallback(
    (id: "lane" | "industry", value: string, label: string) => {
      if (!state) return
      const next = advance(state, { id, value } as never)
      // advance() returns the same state when it rejects an answer.
      if (next === state) return
      setTranscript((t) => [...t, label])
      setState(next)

      if (next.step === "ready" && next.selectedLaneKey) {
        void requestPlan(next.selectedLaneKey, next.industry)
      }
      setFreeText("")
    },
    [state, requestPlan],
  )

  const rewind = useCallback(() => {
    if (!state) return
    setState(goBack(state))
    setTranscript((t) => t.slice(0, -1))
    setPlan(null)
  }, [state])

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {waitingOnParse ? "Reading your résumé…" : "Loading…"}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-800">We could not start the optimiser</p>
        <p className="mt-1 text-sm text-rose-700">{error}</p>
      </div>
    )
  }

  if (!state || !view) return null

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
      <Bubble>
        {view.narrative.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </Bubble>

      {transcript.map((line, i) => (
        <Answer key={i}>{line}</Answer>
      ))}

      {view.question ? (
        <div className="space-y-3">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">
            {view.question.prompt}
          </p>

          {view.question.choices.length > 0 && (
            <div className="grid gap-2">
              {view.question.choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => answer(view.question!.id, choice.value, choice.label)}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <span>
                    <span className="block text-[15px] font-semibold text-slate-900">
                      {choice.label}
                    </span>
                    {choice.hint && (
                      <span className="mt-0.5 block text-[13px] text-slate-500">{choice.hint}</span>
                    )}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          )}

          {view.question.allowFreeText && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const value = freeText.trim()
                if (!value) return
                answer(view.question!.id, value, value)
              }}
              className="flex gap-2"
            >
              <input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={
                  view.question.id === "industry"
                    ? "e.g. Fintech, Healthcare — or pick “Open to all” above"
                    : "e.g. Backend Engineer"
                }
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[15px] outline-none focus:border-slate-400"
              />
              <button
                type="submit"
                disabled={!freeText.trim()}
                className="rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white transition disabled:opacity-40"
                style={{ background: BRAND }}
              >
                Send
              </button>
            </form>
          )}
        </div>
      ) : null}

      {state.step !== "choose_lane" && state.step !== "blocked" && (
        <button
          type="button"
          onClick={rewind}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Change my answer
        </button>
      )}

      {submitting && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building your optimisation plan…
        </div>
      )}

      {plan && !applied && (
        <div className="border-t border-slate-100 pt-5">
          <ResumeFixFlow plan={plan} onApplied={() => setApplied(true)} />
        </div>
      )}

      {applied && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Your résumé has been updated. It is saved to your documents and ready to use.
        </div>
      )}
    </div>
  )
}

export { ANY_INDUSTRY }
