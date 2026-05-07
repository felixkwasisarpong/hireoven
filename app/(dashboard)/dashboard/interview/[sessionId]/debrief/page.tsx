"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Copy, ExternalLink, X } from "lucide-react"
import GeneratingDebriefState from "@/components/interview/GeneratingDebriefState"
import DebriefHero from "@/components/interview/DebriefHero"
import DebriefStrengths from "@/components/interview/DebriefStrengths"
import DebriefGaps from "@/components/interview/DebriefGaps"
import DebriefBetterAnswers from "@/components/interview/DebriefBetterAnswers"
import DebriefCodingPanel from "@/components/interview/DebriefCodingPanel"
import DebriefVoicePanel from "@/components/interview/DebriefVoicePanel"
import DebriefDeliveryPanel from "@/components/interview/DebriefDeliveryPanel"
import DebriefNextSteps from "@/components/interview/DebriefNextSteps"
import DebriefTranscript from "@/components/interview/DebriefTranscript"
import DebriefActions from "@/components/interview/DebriefActions"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

type Strength = { observation: string; quote: string }
type Gap = { observation: string; suggestion: string; quote: string }
type BetterAnswer = { question: string; your_answer: string; stronger_answer: string }
type CodingFeedback = {
  correctness_pct: number; code_quality: string; complexity_awareness: string
  communication: string; time_used_pct: number; biggest_lesson: string
}
type VoiceMetrics = Record<string, unknown>
type VisionFeedback = { eye_contact_pct: number | null; posture_notes: string; framing_notes: string; background_notes: string; warnings: string[] }

type DebriefData = {
  overallScore: number | null
  headline: string | null
  strengths: Strength[]
  gaps: Gap[]
  sampleBetterAnswers: BetterAnswer[]
  codingFeedback: CodingFeedback | null
  voiceFeedback: VoiceMetrics | null
  deliverySignals: VisionFeedback | null
  recommendedNext: string[]
  generatedAt: string
}

type SessionData = {
  id: string; type: string; persona: string; status: string
  durationTargetMin: number; jobId: string | null
  startedAt: string | null; endedAt: string | null; createdAt: string
  metadata?: { practice_focus?: { observation: string; suggestion: string } | null }
}

type TurnData = { id: string; role: string; content: string; turnIndex: number }

// ── Share modal ───────────────────────────────────────────────────────────────

function ShareModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [redactQuotes, setRedactQuotes] = useState(true)
  const [redactVoice, setRedactVoice] = useState(false)
  const [ttlDays, setTtlDays] = useState<7 | 14 | 30>(14)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setIsGenerating(true)
    const res = await fetch(`/api/interview/sessions/${sessionId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redactQuotes, redactVoice, ttlDays }),
    })
    const data = await res.json()
    if (res.ok) { setShareUrl(data.url); setShareId(data.shareId); setExpiresAt(data.expiresAt) }
    setIsGenerating(false)
  }

  async function revoke() {
    if (!shareId) return
    await fetch(`/api/interview/sessions/${sessionId}/share/revoke`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId }),
    })
    setShareUrl(null); setShareId(null)
  }

  function copyUrl() {
    if (shareUrl) { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-slate-900">
            {shareUrl ? "Link ready" : "Share this debrief"}
          </h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!shareUrl ? (
          <>
            <p className="mb-4 text-[13px] text-slate-500">Anyone with the link can view a sanitized version of this debrief.</p>
            <label className="flex items-center gap-2.5 mb-2 cursor-pointer">
              <input type="checkbox" checked={redactQuotes} onChange={(e) => setRedactQuotes(e.target.checked)} className="accent-orange-500" />
              <span className="text-[13px] text-slate-700">Hide my exact quotes</span>
            </label>
            <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
              <input type="checkbox" checked={redactVoice} onChange={(e) => setRedactVoice(e.target.checked)} className="accent-orange-500" />
              <span className="text-[13px] text-slate-700">Hide voice metrics</span>
            </label>
            <div className="mb-5">
              <p className="mb-2 text-[12px] font-semibold text-slate-500">Link expires in:</p>
              <div className="flex gap-2">
                {([7, 14, 30] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setTtlDays(d)}
                    className={cn("rounded-lg border px-3 py-1.5 text-[12px] font-medium transition", ttlDays === d ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                    {d} days
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={generate} disabled={isGenerating}
                className="flex-1 rounded-lg bg-orange-500 py-2 text-[13px] font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
                {isGenerating ? "Generating…" : "Generate link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{shareUrl}</span>
              <button type="button" onClick={copyUrl} className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold text-orange-500 hover:text-orange-600">
                {copied ? "Copied!" : <Copy className="h-3.5 w-3.5" />}
              </button>
              <a href={shareUrl} target="_blank" rel="noopener" className="shrink-0 text-slate-400 hover:text-slate-600">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <p className="text-[12px] text-slate-400 mb-4">
              Expires {expiresAt ? new Date(expiresAt).toLocaleDateString() : "soon"}.
            </p>
            <button type="button" onClick={revoke} className="w-full rounded-lg border border-red-200 py-2 text-[12px] font-semibold text-red-500 hover:bg-red-50">Revoke link</button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Practice picker ───────────────────────────────────────────────────────────

function PracticePickerModal({ gap, gapIndex, sourceSessionId, sessionType, onClose }: {
  gap: Gap; gapIndex: number; sourceSessionId: string; sessionType: string; onClose: () => void
}) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)

  async function startPractice(type: "text" | "live", durationMin: number) {
    setIsCreating(true)
    const res = await fetch("/api/interview/sessions/practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromSessionId: sourceSessionId, gapIndex, practiceType: type, durationMin }),
    })
    const data = await res.json()
    if (res.ok) { router.push(data.redirectTo) } else { setIsCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-slate-900">Practice this in a quick session?</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-[12px] text-slate-500 truncate">Drilling: {gap.observation}</p>
        <div className="space-y-2">
          <button type="button" disabled={isCreating} onClick={() => startPractice("text", 10)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-orange-200 hover:bg-orange-50 disabled:opacity-60">
            <div>
              <p className="text-[13px] font-semibold text-slate-900">10 min text drill</p>
              <p className="text-[12px] text-slate-500">Type your answers, focused on this weakness</p>
            </div>
          </button>
          <button type="button" disabled={isCreating} onClick={() => startPractice("live", 15)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-orange-200 hover:bg-orange-50 disabled:opacity-60">
            <div>
              <p className="text-[13px] font-semibold text-slate-900">15 min live drill</p>
              <p className="text-[12px] text-slate-500">Voice practice, focused on this weakness</p>
            </div>
          </button>
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full text-[12px] text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DebriefPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [loading, setLoading] = useState(true)
  const [debrief, setDebrief] = useState<DebriefData | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [turns, setTurns] = useState<TurnData[]>([])
  const [jobTitle, setJobTitle] = useState<string | null>(null)
  const [jobCompany, setJobCompany] = useState<string | null>(null)
  const [finalCode, setFinalCode] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | undefined>(undefined)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [practiceGap, setPracticeGap] = useState<{ gap: Gap; index: number } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [debriefRes, turnsRes] = await Promise.all([
          fetch(`/api/interview/sessions/${sessionId}/debrief`),
          fetch(`/api/interview/sessions/${sessionId}/turns`),
        ])

        if (debriefRes.ok) {
          const d = await debriefRes.json()
          setDebrief(d.debrief)
          setSession(d.session)
          if (d.session?.jobTitle) { setJobTitle(d.session.jobTitle); setJobCompany(d.session.jobCompany) }
        } else {
          const err = await debriefRes.json()
          setError(err.error ?? "Failed to load debrief")
        }

        if (turnsRes.ok) {
          const t = await turnsRes.json()
          setTurns(t.turns ?? [])
          if (!session) setSession(t.session)

          if (t.session?.type === "coding") {
            const [startRes, snapRes] = await Promise.all([
              fetch(`/api/interview/sessions/${sessionId}/coding/start`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
              }),
              fetch(`/api/interview/sessions/${sessionId}/coding/snapshots`),
            ])
            if (startRes.ok) {
              const aData = await startRes.json()
              setFinalCode(aData.attempt?.finalCode ?? null)
              setLanguage(aData.attempt?.languageUsed)
            }
            if (snapRes.ok) {
              const snapData = await snapRes.json()
              setSnapshotCount((snapData.snapshots ?? []).length)
              if (!language && snapData.language) setLanguage(snapData.language)
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error")
      } finally {
        setLoading(false)
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (loading) return <div className="mx-auto max-w-2xl px-4 py-8"><GeneratingDebriefState /></div>

  if (error && !debrief) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <p className="text-[14px] text-red-600">{error}</p>
        <Link href="/dashboard/interview" className="mt-4 inline-block text-[13px] text-orange-500 hover:text-orange-600">← Back to hub</Link>
      </div>
    )
  }

  const visibleTurns = turns.filter((t) => t.role !== "system")
  const hasAnyContent = visibleTurns.length > 0 || (debrief?.overallScore !== null && debrief?.overallScore !== undefined)

  if (!hasAnyContent && session?.status === "abandoned") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <p className="text-[14px] font-semibold text-slate-900">This session was ended before any questions were answered.</p>
        <p className="mt-1 text-[13px] text-slate-500">Nothing to debrief yet — start a new one.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/dashboard/interview" className="rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-orange-600">Start a new session</Link>
          <Link href="/dashboard/interview/history" className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50">View history</Link>
        </div>
      </div>
    )
  }

  const d = debrief!
  const s = session!
  const isPracticeSession = Boolean(s.metadata?.practice_focus)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/dashboard/interview" className="mb-6 flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to interview hub
      </Link>

      {/* Practice comparison banner */}
      {isPracticeSession && (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-orange-700">Practice drill debrief</p>
          <p className="mt-0.5 text-[12px] text-orange-600">
            Drilling: {s.metadata?.practice_focus?.observation}
          </p>
          <p className="mt-1.5 text-[12px] text-orange-500">
            Did you fix it? Compare your gaps below against the original weakness above.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {d.overallScore !== null && (
          <DebriefHero score={d.overallScore} headline={d.headline ?? ""} type={s.type} persona={s.persona}
            jobTitle={jobTitle} jobCompany={jobCompany} sessionDate={s.createdAt} durationMin={s.durationTargetMin} />
        )}

        <DebriefStrengths strengths={(d.strengths ?? []) as Strength[]} />

        {/* Gap cards with practice picker */}
        {(d.gaps ?? []).length > 0 && (
          <section>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-orange-600">Gaps to close</h2>
            <div className="space-y-3">
              {(d.gaps as Gap[]).map((g, i) => (
                <div key={i} className="rounded-xl border border-orange-100 bg-orange-50/40 py-3 pl-4 pr-4 border-l-4 border-l-orange-500">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold text-slate-900">△ {g.observation}</p>
                    <button type="button" onClick={() => setPracticeGap({ gap: g, index: i })}
                      className="shrink-0 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200">
                      Practice this →
                    </button>
                  </div>
                  {g.quote && <p className="mt-1.5 text-[12px] italic text-slate-500">&ldquo;{g.quote}&rdquo;</p>}
                  {g.suggestion && <p className="mt-1.5 text-[12px] text-slate-700"><span className="font-semibold text-orange-700">Fix: </span>{g.suggestion}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <DebriefBetterAnswers answers={(d.sampleBetterAnswers ?? []) as BetterAnswer[]} />

        {s.type === "coding" && d.codingFeedback && (
          <DebriefCodingPanel feedback={d.codingFeedback as CodingFeedback} sessionId={sessionId} language={language} snapshotCount={snapshotCount} />
        )}

        {s.type === "live" && <DebriefVoicePanel metrics={d.voiceFeedback as Parameters<typeof DebriefVoicePanel>[0]["metrics"]} />}
        {s.type === "live" && d.deliverySignals && <DebriefDeliveryPanel signals={d.deliverySignals as VisionFeedback} />}

        <DebriefNextSteps steps={(d.recommendedNext ?? []) as string[]} />
        <DebriefTranscript turns={turns} finalCode={finalCode} language={language} />

        {/* Actions with enabled share button */}
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/interview" className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">
            Run another
          </Link>
          {s.jobId ? (
            <Link href={`/dashboard/interview/setup?type=${s.type}&jobId=${s.jobId}`}
              className="rounded-lg bg-orange-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-orange-600">
              Practice again
            </Link>
          ) : (
            <Link href={`/dashboard/interview/setup?type=${s.type}`}
              className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-[13px] font-semibold text-orange-600 transition hover:bg-orange-100">
              Practice again
            </Link>
          )}
          <button type="button" onClick={() => setShowShare(true)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">
            Share with mentor
          </button>
        </div>
      </div>

      {/* Share modal */}
      {showShare && <ShareModal sessionId={sessionId} onClose={() => setShowShare(false)} />}

      {/* Practice picker modal */}
      {practiceGap && (
        <PracticePickerModal
          gap={practiceGap.gap}
          gapIndex={practiceGap.index}
          sourceSessionId={sessionId}
          sessionType={s.type}
          onClose={() => setPracticeGap(null)}
        />
      )}
    </div>
  )
}
