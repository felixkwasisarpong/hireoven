"use client"

import {
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react"
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
  /** Daily missions — shown above the action tiles in idle state */
  missions?: ScoutMission[]
  momentumLine?: string
  onMissionLaunch?: (query: string) => void
  onMissionDismiss?: (missionId: string) => void
  onMissionsDisable?: () => void
  continuationContexts?: ScoutResumableContext[]
  onContinuationOpen?: (context: ScoutResumableContext) => void
  /** True on the user's very first Scout session — shows welcome banner */
  isFirstRun?: boolean
  /** True when the Hireoven extension is not connected */
  showExtensionPromo?: boolean
  /** True when the user has saved jobs / applications data */
  hasData?: boolean
  onDismissFirstRun?: () => void
  onDismissExtPromo?: () => void
}


function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] shadow-[0_2px_8px_rgba(255,92,24,0.3)]">
        <Sparkles className="h-3 w-3 text-white" />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
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
}: Props) {
  const { showUpgrade } = useUpgradeModal()
  const hasConversation = messages.length > 0
  const starterActions = hasData
    ? [
        {
          title: "Find high-fit roles",
          query: "Show jobs worth my time and rank them by fit",
        },
        {
          title: "Compare saved jobs",
          query: "Compare my top saved jobs and pick the best one",
        },
        {
          title: "Tailor my resume",
          query: "Tailor my resume for my strongest match",
        },
        {
          title: "Run application workflow",
          query: "Build my application workflow for this week",
        },
      ]
    : [
        {
          title: "Start with a search plan",
          query: "Create a practical search plan for me",
        },
        {
          title: "Find sponsorship-friendly roles",
          query: "Find sponsorship-friendly roles matching my profile",
        },
      ]

  return (
    <div className="mx-auto w-full max-w-4xl">

      {/* ── Empty / idle state ── */}
      {!hasConversation && !isLoading && (
        <div>
          {/* First-run welcome banner — shown once on first session */}
          {isFirstRun ? (
            <ScoutFirstRunBanner
              firstName={firstName}
              onDismiss={onDismissFirstRun ?? (() => {})}
              onTileClick={onTileClick}
            />
          ) : (
            <>
              {/* Salutation hero — first focal element in idle state */}
              <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#FFE0D2] pb-4">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FF5C18]">
                    <Sparkles className="h-3 w-3" />
                    Scout is ready
                  </p>
                  <h2 className="mt-1.5 text-3xl font-semibold tracking-tight text-slate-900">
                    {greeting}, {firstName}.
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {!hasData
                      ? "Scout prepares applications, research, and workflows — you stay in control."
                      : "What are you working on today?"}
                  </p>
                </div>

                {hasSession && onStartFresh && (
                  <button
                    type="button"
                    onClick={onStartFresh}
                    className="mt-1 inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                  >
                    <RotateCcw className="h-3 w-3" />
                    New chat
                  </button>
                )}
              </div>

              {/* Resume refreshed notice */}
              {resumeRefreshedNotice && (
                <div className="mb-3 inline-flex items-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]" />
                  Scout refreshed context for your updated resume.
                </div>
              )}

              {/* Extension promo — shown when extension not connected + not dismissed */}
              {showExtensionPromo && !hasSession && onDismissExtPromo && (
                <ScoutExtensionPromo onDismiss={onDismissExtPromo} />
              )}
            </>
          )}

          {/* Starter actions — compact command chips, not card grid */}
          <div className="mb-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Run a command
            </p>
            <div className="flex flex-wrap gap-2">
              {starterActions.map((action) => (
                <button
                  key={action.title}
                  type="button"
                  onClick={() => onTileClick(action.query)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-[#FF5C18]/40 hover:bg-[#FFF8F5] hover:text-[#FF5C18]"
                >
                  {action.title}
                </button>
              ))}
            </div>
          </div>

          {/* Daily mission strip */}
          {!strategyLoading && missions.length > 0 && onMissionLaunch && onMissionDismiss && onMissionsDisable && (
            <ScoutMissionStrip
              missions={missions}
              momentumLine={momentumLine}
              onLaunch={onMissionLaunch}
              onDismiss={onMissionDismiss}
              onDisableAll={onMissionsDisable}
            />
          )}

          {/* Continue session — resume prior context */}
          {continuationContexts.length > 0 && onContinuationOpen && (
            <div className="mb-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Continue where you left off
              </p>
              <div className="space-y-1.5">
                {continuationContexts.slice(0, 2).map((context) => (
                  <button
                    key={`${context.type}:${context.id}`}
                    type="button"
                    onClick={() => onContinuationOpen(context)}
                    className="group w-full text-left text-sm text-slate-700 transition hover:text-[#FF5C18]"
                  >
                    <p className="font-medium">
                      {context.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400 group-hover:text-slate-500">
                      {context.type.replace(/_/g, " ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

{/* Nudges — use the shared component for consistent icons + dismiss */}
          {!strategyLoading && nudges.length > 0 && (
            <div className="mb-5">
              <ScoutNudgeStrip nudges={nudges} />
            </div>
          )}

          {/* Recent commands — from saved session */}
          {recentCommands.length > 0 && (
            <div className="mb-7">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Recent
              </p>
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

          {/* Trust + safety copy — persistent, subtle */}
          <div className="mt-6">
            <ScoutTrustBadge variant="strip" />
          </div>
        </div>
      )}

      {/* ── Conversation thread ── */}
      {(hasConversation || isLoading) && (
        <div className="space-y-4">
          {hasConversation && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-100" />
              <button
                type="button"
                onClick={onClearChat}
                className="text-[11px] text-slate-400 transition hover:text-slate-600"
              >
                Clear chat
              </button>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm leading-6 text-white shadow-sm">
                    {msg.text}
                  </div>
                </div>
              )
            }
            if (msg.role === "scout_streaming") {
              return (
                <div key={msg.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#FF5C18] shadow-[0_2px_8px_rgba(255,92,24,0.3)]">
                    <Sparkles className="h-3 w-3 text-white animate-pulse" />
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
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      )}
    </div>
  )
}
