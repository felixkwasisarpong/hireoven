"use client"

import { useEffect, useState } from "react"
import { ArrowRight, RefreshCw, RotateCcw, Sparkles } from "lucide-react"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { ScoutMissionStrip } from "@/components/scout/ScoutMissionStrip"
import { ScoutNudgeStrip } from "@/components/scout/ScoutNudgeStrip"
import { ScoutStreamingText } from "@/components/scout/ScoutStreamingText"
import { ScoutFirstRunBanner } from "@/components/scout/ScoutFirstRunBanner"
import { ScoutExtensionPromo } from "@/components/scout/ScoutExtensionPromo"
import { ScoutTrustBadge } from "@/components/scout/ScoutTrustBadge"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ScoutNudge } from "@/lib/scout/nudges"
import type { ScoutMission } from "@/lib/scout/missions/types"
import type { ScoutResumableContext } from "@/lib/scout/continuation/types"

type ChatMessage =
  | { id: string; role: "user";            text: string }
  | { id: string; role: "scout";           response: ScoutResponse }
  | { id: string; role: "scout_streaming"; streamText: string }

type Props = {
  greeting: string
  firstName: string
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  nudges: ScoutNudge[]
  strategyLoading: boolean
  resumeRefreshedNotice: boolean
  onClearChat: () => void
  onTileClick: (query: string) => void
  chatEndRef: React.RefObject<HTMLDivElement>
  recentCommands?: string[]
  hasSession?: boolean
  onStartFresh?: () => void
  userInitial?: string
  missions?: ScoutMission[]
  momentumLine?: string
  onMissionLaunch?: (query: string) => void
  onMissionDismiss?: (missionId: string) => void
  onMissionsDisable?: () => void
  continuationContexts?: ScoutResumableContext[]
  onContinuationOpen?: (context: ScoutResumableContext) => void
  isFirstRun?: boolean
  showExtensionPromo?: boolean
  hasData?: boolean
  onDismissFirstRun?: () => void
  onDismissExtPromo?: () => void
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.35)]">
        <span className="absolute inset-0 animate-ping rounded-xl bg-[#FF5C18] opacity-20" />
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </span>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-3.5 shadow-sm">
        <span className="text-[12px] font-medium text-slate-400">Scout is thinking</span>
        <span className="flex items-center gap-1">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]/50 animate-bounce"
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
  isFirstRun = false,
  showExtensionPromo = false,
  hasData = true,
  onDismissFirstRun,
  onDismissExtPromo,
  userInitial,
}: Props) {
  const { showUpgrade } = useUpgradeModal()
  const hasConversation = messages.length > 0

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40)
    return () => clearTimeout(t)
  }, [])

  const starterActions = hasData
    ? [
        { title: "Find high-fit roles",      query: "Show jobs worth my time and rank them by fit" },
        { title: "Compare saved jobs",        query: "Compare my top saved jobs and pick the best one" },
        { title: "Tailor my resume",          query: "Tailor my resume for my strongest match" },
        { title: "Run application workflow",  query: "Build my application workflow for this week" },
      ]
    : [
        { title: "Start with a search plan",       query: "Create a practical search plan for me" },
        { title: "Find sponsorship-friendly roles", query: "Find sponsorship-friendly roles matching my profile" },
      ]

  const fade = "transition-all duration-500 ease-out"
  const show = "opacity-100 translate-y-0"
  const hide = "opacity-0 translate-y-4"

  return (
    <div className="mx-auto w-full max-w-2xl">

      {/* ── Idle / empty state ─────────────────────────────────────────── */}
      {!hasConversation && !isLoading && (
        <div>
          {isFirstRun ? (
            <ScoutFirstRunBanner
              firstName={firstName}
              onDismiss={onDismissFirstRun ?? (() => {})}
              onTileClick={onTileClick}
            />
          ) : (
            <>
              {/* Hero greeting */}
              <div className={`mb-10 ${fade} ${mounted ? show : hide}`}>
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[#FFD5C2] bg-[#FFF8F5] px-3 py-1 text-[11px] font-semibold text-[#FF5C18]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18] animate-pulse" />
                  Scout is ready
                </div>
                <h2 className="text-[2.1rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2.4rem]">
                  {greeting}, {firstName}.
                </h2>
                <p className="mt-2.5 text-base text-slate-500">
                  {!hasData
                    ? "Scout prepares applications, research, and workflows — you stay in control."
                    : "What are you working on today?"}
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
              </div>

              {resumeRefreshedNotice && (
                <div className={`mb-5 inline-flex items-center gap-2 text-xs text-slate-500 ${fade} ${mounted ? show : hide}`}
                  style={{ transitionDelay: "60ms" }}>
                  <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]" />
                  Scout refreshed context for your updated resume.
                </div>
              )}

              {showExtensionPromo && !hasSession && onDismissExtPromo && (
                <div className={`mb-5 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "60ms" }}>
                  <ScoutExtensionPromo onDismiss={onDismissExtPromo} />
                </div>
              )}
            </>
          )}

          {/* Action cards */}
          <div
            className={`mb-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${fade} ${mounted ? show : hide}`}
            style={{ transitionDelay: "110ms" }}
          >
            {starterActions.map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => onTileClick(action.query)}
                className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-all duration-200 hover:border-[#FF5C18]/35 hover:bg-[#FFF9F7] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C18]/30"
              >
                <span className="text-sm font-medium text-slate-700 transition-colors group-hover:text-[#FF5C18]">
                  {action.title}
                </span>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#FF5C18]" />
              </button>
            ))}
          </div>

          {/* Daily missions */}
          {!strategyLoading && missions.length > 0 && onMissionLaunch && onMissionDismiss && onMissionsDisable && (
            <div className={`mb-6 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "180ms" }}>
              <ScoutMissionStrip
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
                    className="group w-full text-left transition hover:text-[#FF5C18]"
                  >
                    <p className="text-sm font-medium text-slate-700 group-hover:text-[#FF5C18]">{context.title}</p>
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
              <ScoutNudgeStrip nudges={nudges} />
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
                    className="max-w-xs truncate rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-600 transition hover:border-[#FF5C18]/40 hover:bg-[#FFF8F5] hover:text-[#FF5C18]"
                    title={cmd}
                  >
                    {cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`mt-4 ${fade} ${mounted ? show : hide}`} style={{ transitionDelay: "300ms" }}>
            <ScoutTrustBadge variant="strip" />
          </div>
        </div>
      )}

      {/* ── Conversation thread ────────────────────────────────────────── */}
      {(hasConversation || isLoading) && (
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
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
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

            if (msg.role === "scout_streaming") {
              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <span className="relative mt-0.5 flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.35)]">
                    <span className="absolute inset-0 animate-ping rounded-xl bg-[#FF5C18] opacity-20" />
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-4 shadow-sm">
                    <div className="h-[2px] w-[calc(100%+2.5rem)] bg-[#FF5C18] -mx-5 -mt-4 mb-3" />
                    {msg.streamText
                      ? <ScoutStreamingText text={msg.streamText} />
                      : <TypingIndicator />
                    }
                  </div>
                </div>
              )
            }

            return (
              <ScoutMessageBubble
                key={msg.id}
                response={msg.response}
                context="dashboard"
                compact={false}
                onUpgrade={showUpgrade}
              />
            )
          })}

          {isLoading && <TypingIndicator />}

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
