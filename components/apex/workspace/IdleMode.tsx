"use client"

import { useEffect, useState } from "react"
import { RefreshCw, RotateCcw, Sparkles } from "lucide-react"
import { ApexCareerTwinCard } from "@/components/apex/ApexCareerTwinCard"
import { ApexMessageBubble } from "@/components/apex/ApexMessageBubble"
import { ApexMissionStrip } from "@/components/apex/ApexMissionStrip"
import { ApexNudgeStrip } from "@/components/apex/ApexNudgeStrip"
import { ApexStreamingText } from "@/components/apex/ApexStreamingText"
import { ApexTodayPlanCard } from "@/components/apex/ApexTodayPlanCard"
import { ApexExtensionPromo } from "@/components/apex/ApexExtensionPromo"
import { ApexTrustBadge } from "@/components/apex/ApexTrustBadge"
import { ApexSuggestedCommands } from "@/components/apex/workspace/scenes/ApexSuggestedCommands"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import type { ApexResponse, ApexStrategyBoard } from "@/lib/apex/types"
import type { ApexNudge } from "@/lib/apex/nudges"
import type { ApexMission } from "@/lib/apex/missions/types"
import type { ApexResumableContext } from "@/lib/apex/continuation/types"

type ChatMessage =
  | { id: string; role: "user";            text: string }
  | { id: string; role: "apex";           response: ApexResponse }
  | { id: string; role: "apex_streaming"; streamText: string }

type Props = {
  greeting: string
  firstName: string
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  nudges: ApexNudge[]
  strategyLoading: boolean
  resumeRefreshedNotice: boolean
  onClearChat: () => void
  onTileClick: (query: string) => void
  onRunCommand?: (query: string) => void
  chatEndRef: React.RefObject<HTMLDivElement>
  recentCommands?: string[]
  hasSession?: boolean
  onStartFresh?: () => void
  userInitial?: string
  missions?: ApexMission[]
  momentumLine?: string
  onMissionLaunch?: (query: string) => void
  onMissionDismiss?: (missionId: string) => void
  onMissionsDisable?: () => void
  continuationContexts?: ApexResumableContext[]
  onContinuationOpen?: (context: ApexResumableContext) => void
  showExtensionPromo?: boolean
  hasData?: boolean
  onDismissExtPromo?: () => void
  strategyBoard: ApexStrategyBoard | null
  careerTwin: CareerTwinSnapshot | null
  careerTwinHistory?: CareerTwinSnapshot[]
  careerTwinLoading?: boolean
  careerTwinRefreshing?: boolean
  careerTwinError?: string | null
  onRefreshCareerTwin?: () => void
  onOpenPlanHistory?: () => void
  onPlanStateCommitted?: () => void
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#2563EB] shadow-[0_4px_14px_rgba(37,99,235,0.35)]">
        <span className="absolute inset-0 animate-ping rounded-xl bg-[#2563EB] opacity-20" />
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </span>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-3.5 shadow-sm">
        <span className="text-[12px] font-medium text-slate-400">Apex is thinking</span>
        <span className="flex items-center gap-1">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 rounded-full bg-[#2563EB]/50 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

export function IdleMode({
  greeting,
  firstName,
  messages,
  isLoading,
  error,
  nudges,
  strategyLoading,
  resumeRefreshedNotice,
  onClearChat,
  onTileClick,
  onRunCommand,
  chatEndRef,
  recentCommands = [],
  hasSession = false,
  onStartFresh,
  missions = [],
  momentumLine,
  onMissionLaunch,
  onMissionDismiss,
  onMissionsDisable,
  continuationContexts = [],
  onContinuationOpen,
  showExtensionPromo = false,
  hasData = true,
  onDismissExtPromo,
  strategyBoard,
  careerTwin,
  careerTwinHistory = [],
  careerTwinLoading = false,
  careerTwinRefreshing = false,
  careerTwinError = null,
  onRefreshCareerTwin,
  onOpenPlanHistory,
  onPlanStateCommitted,
  userInitial,
}: Props) {
  const { showUpgrade } = useUpgradeModal()
  const hasConversation = messages.length > 0
  const lastUserIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return index
    }
    return -1
  })()
  const lastTurnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : []
  const hasStreamingMessage = lastTurnMessages.some((msg) => msg.role === "apex_streaming")
  const hasApexReplyForLatestTurn = lastTurnMessages.some((msg) => msg.role === "apex")
  const lastUserMessage = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined
  const showRecoverySurface =
    hasConversation &&
    !isLoading &&
    Boolean(error) &&
    lastUserIndex >= 0 &&
    !hasApexReplyForLatestTurn &&
    !hasStreamingMessage

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40)
    return () => clearTimeout(t)
  }, [])

  const quickActions = hasData
    ? [
        { title: "Run today's attack plan", query: "Run autonomous hunt for today", hint: "Apex ranks the live queue for you" },
        { title: "Find high-fit roles", query: "Show jobs worth my time and rank them by fit", hint: "Freshness, fit, and urgency" },
        { title: "Compare saved jobs", query: "Compare my top saved jobs and pick the best one", hint: "Choose the best next bet" },
        { title: "Tailor my resume", query: "Tailor my resume for my strongest match", hint: "Targeted edits and positioning" },
        { title: "Run application workflow", query: "Build my application workflow for this week", hint: "Structure the next few moves" },
      ]
    : [
        { title: "Run today's attack plan", query: "Run autonomous hunt for today", hint: "Apex builds your starting queue" },
        { title: "Start with a search plan", query: "Create a practical search plan for me", hint: "Practical and profile-aware" },
        { title: "Find sponsorship-friendly roles", query: "Find sponsorship-friendly roles matching my profile", hint: "Explicit immigration openness" },
      ]

  const fade = "transition-all duration-500 ease-out"
  const show = "opacity-100 translate-y-0"
  const hide = "opacity-0 translate-y-4"

  return (
    <div className={`mx-auto w-full ${(!hasConversation && !isLoading) || showRecoverySurface ? "max-w-6xl" : "max-w-2xl"}`}>

      {/* ── Idle / empty state ─────────────────────────────────────────── */}
      {((!hasConversation && !isLoading) || showRecoverySurface) && (
        <div>
          <>
            <div className={`${fade} ${mounted ? show : hide}`}>
              <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-blue-700 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] animate-pulse" />
                {showRecoverySurface ? "Apex recovered" : "Apex is ready"}
              </div>
              <h2 className="text-[1.85rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2.2rem]">
                {showRecoverySurface
                  ? "Recover and continue from the next best move."
                  : `${greeting}, ${firstName}. Keep the next move clean.`}
              </h2>
              <p className="mt-2.5 text-base text-slate-500">
                {showRecoverySurface
                  ? "The last command did not complete. Retry it, clear it, or move straight into a cleaner workspace."
                  : !hasData
                    ? "Apex prepares applications, research, and workflows. Start with the command or launch card that matches your intent."
                    : "Apex already has a read on your search. Start with the strongest move, not the loudest one."}
              </p>
              {hasSession && onStartFresh && (
                <button
                  type="button"
                  onClick={onStartFresh}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Start fresh
                </button>
              )}

              <div
                className={`mt-5 ${fade} ${mounted ? show : hide}`}
                style={{ transitionDelay: "120ms" }}
              >
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Quick Actions
                </p>
                <ApexSuggestedCommands
                  suggestions={quickActions.map((action) => ({
                    label: action.title,
                    query: action.query,
                    hint: action.hint,
                  }))}
                  onSelect={onTileClick}
                  className="xl:grid-cols-2"
                />
              </div>

              {showRecoverySurface && error && (
                <div
                  className={`mt-5 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-4 ${fade} ${mounted ? show : hide}`}
                  style={{ transitionDelay: "45ms" }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-500">Last command failed</p>
                  <p className="mt-1.5 text-sm font-medium leading-6 text-red-800">{error}</p>
                  {lastUserMessage?.role === "user" && (
                    <p className="mt-2 text-[12px] leading-5 text-red-700/90">
                      Attempted request: “{lastUserMessage.text.length > 160 ? `${lastUserMessage.text.slice(0, 157)}…` : lastUserMessage.text}”
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lastUserMessage?.role === "user" && (
                      <button
                        type="button"
                        onClick={() => (onRunCommand ?? onTileClick)(lastUserMessage.text)}
                        className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
                      >
                        Retry last command
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClearChat}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                    >
                      Clear failed thread
                    </button>
                  </div>
                </div>
              )}

              {resumeRefreshedNotice && (
                <div className={`mt-5 inline-flex items-center gap-2 text-xs text-slate-500 ${fade} ${mounted ? show : hide}`}
                  style={{ transitionDelay: "60ms" }}>
                  <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-[#2563EB]" />
                  Apex refreshed context for your updated resume.
                </div>
              )}

              {showExtensionPromo && !hasSession && onDismissExtPromo && (
                <div className={`mt-5 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "60ms" }}>
                  <ApexExtensionPromo onDismiss={onDismissExtPromo} />
                </div>
              )}
            </div>
          </>

          <div
            className={`mb-6 mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] ${fade} ${mounted ? show : hide}`}
            style={{ transitionDelay: "160ms" }}
          >
            <ApexTodayPlanCard
              board={strategyBoard}
              nudges={nudges}
              isLoading={strategyLoading}
              hasData={hasData}
              onActionClick={onRunCommand}
              onOpenHistory={onOpenPlanHistory}
              onPlanStateCommitted={onPlanStateCommitted}
              twin={careerTwin}
              history={careerTwinHistory}
              variant="summary"
            />
            <ApexCareerTwinCard
              twin={careerTwin}
              history={careerTwinHistory}
              isLoading={careerTwinLoading}
              isRefreshing={careerTwinRefreshing}
              error={careerTwinError}
              onRefresh={onRefreshCareerTwin}
              onRunFocus={onRunCommand}
              variant="summary"
            />
          </div>

          {/* Daily missions */}
          {!strategyLoading && missions.length > 0 && onMissionLaunch && onMissionDismiss && onMissionsDisable && (
            <div className={`mb-6 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "180ms" }}>
              <ApexMissionStrip
                missions={missions}
                momentumLine={momentumLine}
                onLaunch={onMissionLaunch}
                onDismiss={onMissionDismiss}
                onDisableAll={onMissionsDisable}
              />
            </div>
          )}

          {/* Continue session */}
          {continuationContexts.length > 0 && onContinuationOpen && (
            <div className={`mb-6 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "200ms" }}>
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Continue where you left off
              </p>
              <div className="space-y-1.5">
                {continuationContexts.slice(0, 2).map((context) => (
                  <button
                    key={`${context.type}:${context.id}`}
                    type="button"
                    onClick={() => onContinuationOpen(context)}
                    className="group w-full text-left transition hover:text-[#2563EB]"
                  >
                    <p className="text-sm font-medium text-slate-700 group-hover:text-[#2563EB]">{context.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400 group-hover:text-slate-500">
                      {context.type.replace(/_/g, " ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nudges */}
          {!strategyLoading && nudges.length > 0 && (
            <div className={`mb-6 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "220ms" }}>
              <ApexNudgeStrip nudges={nudges} />
            </div>
          )}

          {/* Recent commands */}
          {recentCommands.length > 0 && (
            <div className={`mb-6 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "250ms" }}>
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Recent</p>
              <div className="flex flex-wrap gap-2">
                {recentCommands.slice(0, 4).map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => onTileClick(cmd)}
                    className="max-w-xs truncate rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-600 transition hover:border-[#2563EB]/40 hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                    title={cmd}
                  >
                    {cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`mt-4 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "300ms" }}>
            <ApexTrustBadge variant="strip" />
          </div>
        </div>
      )}

      {/* ── Conversation thread ────────────────────────────────────────── */}
      {(hasConversation || isLoading) && !showRecoverySurface && (
        <div className="space-y-5">
          {hasConversation && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-100" />
              <button
                type="button"
                onClick={onClearChat}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-600"
              >
                <RotateCcw className="h-3 w-3" />
                Clear chat
              </button>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex items-end justify-end gap-2.5">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-900 px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
                    {msg.text}
                  </div>
                  {userInitial ? (
                    <span className="mb-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600 ring-2 ring-white">
                      {userInitial}
                    </span>
                  ) : (
                    <span className="mb-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 ring-2 ring-white">
                      <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                      </svg>
                    </span>
                  )}
                </div>
              )
            }

            if (msg.role === "apex_streaming") {
              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <span className="relative mt-0.5 flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[#2563EB] shadow-[0_4px_14px_rgba(37,99,235,0.35)]">
                    <span className="absolute inset-0 animate-ping rounded-xl bg-[#2563EB] opacity-20" />
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-4 shadow-sm">
                    <div className="h-[2px] w-[calc(100%+2.5rem)] bg-[#2563EB] -mx-5 -mt-4 mb-3" />
                    {msg.streamText
                      ? <ApexStreamingText text={msg.streamText} />
                      : <TypingIndicator />
                    }
                  </div>
                </div>
              )
            }

            return (
              <ApexMessageBubble
                key={msg.id}
                response={msg.response}
                context="dashboard"
                compact={false}
                onUpgrade={showUpgrade}
              />
            )
          })}

          {isLoading && !hasStreamingMessage && <TypingIndicator />}

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50/60 px-4 py-3">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400" />
              <p className="text-sm leading-relaxed text-red-700">{error}</p>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      )}
    </div>
  )
}
