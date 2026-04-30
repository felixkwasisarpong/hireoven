"use client"

import {
  BarChart2,
  BookOpen,
  Briefcase,
  Building2,
  FileText,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react"
import { ScoutChatbotAnimation } from "@/components/scout/ScoutChatbotAnimation"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { ScoutMissionStrip } from "@/components/scout/ScoutMissionStrip"
import { ScoutStreamingText } from "@/components/scout/ScoutStreamingText"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ScoutNudge } from "@/lib/scout/nudges"
import type { ScoutMission } from "@/lib/scout/missions/types"
import { cn } from "@/lib/utils"

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
}

const ACTION_TILES = [
  {
    icon: Search,
    iconBg: "bg-slate-950 text-white",
    title: "Find jobs",
    description: "Search and filter live roles matching your profile",
    query: "Find remote backend engineering jobs that sponsor H-1B",
  },
  {
    icon: FileText,
    iconBg: "bg-[#FF5C18] text-white",
    title: "Tailor my resume",
    description: "Adapt your CV to a specific role or company",
    query: "Tailor my resume for a senior software engineer role",
  },
  {
    icon: BarChart2,
    iconBg: "bg-slate-900 text-white",
    title: "Compare roles",
    description: "Scout ranks your saved jobs and explains the tradeoffs",
    query: "Compare my saved jobs and tell me which to apply to first",
  },
  {
    icon: BookOpen,
    iconBg: "bg-slate-950 text-white",
    title: "Interview prep",
    description: "Questions, topics, and talking points for your next interview",
    query: "Help me prepare for a software engineering interview",
  },
  {
    icon: Building2,
    iconBg: "bg-[#FF5C18] text-white",
    title: "Company intel",
    description: "H-1B signals, LCA data, and sponsorship history",
    query: "What are the strongest H-1B sponsoring companies in tech?",
  },
  {
    icon: Briefcase,
    iconBg: "bg-slate-900 text-white",
    title: "My pipeline",
    description: "Review your applications and plan next steps",
    query: "What's the status of my applications and what should I do next?",
  },
]

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
        <ScoutChatbotAnimation />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]/50 animate-bounce"
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
}: Props) {
  const { showUpgrade } = useUpgradeModal()
  const hasConversation = messages.length > 0

  return (
    <div className="mx-auto w-full max-w-3xl">

      {/* Resume refreshed notice */}
      {resumeRefreshedNotice && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          Scout refreshed context for your updated resume.
        </div>
      )}

      {/* ── Empty / idle state ── */}
      {!hasConversation && !isLoading && (
        <div>
          {/* Greeting row */}
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#FF5C18]">
                Scout workspace
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                {greeting}, {firstName}.
              </h2>
              <p className="mt-1.5 text-base text-gray-400">
                What are you working on today?
              </p>
            </div>

            {/* Start fresh */}
            {hasSession && onStartFresh && (
              <button
                type="button"
                onClick={onStartFresh}
                className="mt-1 inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-400 transition hover:border-gray-300 hover:text-gray-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Start fresh
              </button>
            )}
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

          {/* Nudge strip */}
          {!strategyLoading && nudges.length > 0 && (
            <div className="mb-6 space-y-2">
              {nudges.slice(0, 2).map((nudge, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border-l-2 px-4 py-3",
                    nudge.severity === "warning"
                      ? "border-amber-400 bg-amber-50"
                      : nudge.severity === "opportunity"
                        ? "border-[#FF5C18] bg-orange-50/50"
                        : "border-gray-300 bg-gray-50"
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn(
                      "text-sm font-semibold",
                      nudge.severity === "warning" ? "text-amber-800" :
                      nudge.severity === "opportunity" ? "text-[#9A3412]" :
                      "text-gray-800"
                    )}>
                      {nudge.title}
                    </p>
                    {nudge.description && (
                      <p className="mt-0.5 text-xs text-gray-500 leading-5">
                        {nudge.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent commands — from saved session */}
          {recentCommands.length > 0 && (
            <div className="mb-7">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Recent
              </p>
              <div className="flex flex-wrap gap-2">
                {recentCommands.slice(0, 4).map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => onTileClick(cmd)}
                    className="max-w-xs truncate rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-xs font-medium text-gray-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                    title={cmd}
                  >
                    {cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action tile grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACTION_TILES.map((tile) => {
              const Icon = tile.icon
              return (
                <button
                  key={tile.title}
                  type="button"
                  onClick={() => onTileClick(tile.query)}
                  className="group flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-[#FF5C18]/30 hover:shadow-[0_8px_24px_rgba(255,92,24,0.08)]"
                >
                  <span className={cn(
                    "mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl",
                    tile.iconBg
                  )}>
                    <Icon className="h-4 w-4" style={{ height: 18, width: 18 }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#FF5C18]">
                      {tile.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-gray-400">
                      {tile.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Conversation thread ── */}
      {(hasConversation || isLoading) && (
        <div className="space-y-5">
          {hasConversation && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Conversation
              </p>
              <button
                type="button"
                onClick={onClearChat}
                className="text-xs text-gray-400 transition hover:text-gray-700"
              >
                Clear
              </button>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-[#FF5C18] px-4 py-3 text-sm leading-6 text-white shadow-[0_4px_12px_rgba(255,92,24,0.22)]">
                    {msg.text}
                  </div>
                </div>
              )
            }
            if (msg.role === "scout_streaming") {
              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <span className="relative mt-0.5 flex-shrink-0 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#FF5C18] shadow-[0_4px_16px_rgba(255,92,24,0.35)]">
                    <ScoutChatbotAnimation />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.07)]">
                    <div className="h-[3px] w-full bg-[#FF5C18] opacity-80 -mx-5 -mt-4 mb-3 w-[calc(100%+2.5rem)]" />
                    {msg.streamText
                      ? <ScoutStreamingText text={msg.streamText} />
                      : <span className="flex gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF5C18]/50" style={{ animationDelay: "0ms" }} /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF5C18]/50" style={{ animationDelay: "160ms" }} /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#FF5C18]/50" style={{ animationDelay: "320ms" }} /></span>
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
