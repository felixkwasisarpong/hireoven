"use client"

import {
  ArrowRight,
  BellRing,
  Bot,
  ChevronRight,
  Command,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Target,
} from "lucide-react"
import { useRef } from "react"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { ScoutResponse, ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutNudge } from "@/lib/scout/nudges"
function TopNudgesGrid({ nudges }: { nudges: ScoutNudge[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {nudges.map((nudge) => {
        const tone =
          nudge.severity === "warning"
            ? "border-amber-200 bg-amber-50/70 text-amber-700"
            : nudge.severity === "opportunity"
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-700"
              : "border-orange-200 bg-orange-50/70 text-orange-700"

        return (
          <article
            key={nudge.id}
            className="group min-h-[128px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${tone}`}>
                <BellRing className="h-4 w-4" />
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {nudge.severity}
              </span>
            </div>

            <h3 className="mt-3 text-sm font-bold text-slate-950">{nudge.title}</h3>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">
              {nudge.description}
            </p>

            {nudge.action && (
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-orange-600">
                Action available
                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

export type ScoutOverviewTabProps = {
  greeting: string
  firstName: string
  query: string
  setQuery: (v: string) => void
  isLoading: boolean
  isCommandMode: boolean
  setIsCommandMode: (fn: (v: boolean) => boolean) => void
  suggestionChips: readonly string[]
  messages: ChatMessage[]
  error: string | null
  resumeRefreshedNotice: boolean
  strategyBoard: ScoutStrategyBoard | null
  strategyLoading: boolean
  nudges: ScoutNudge[]
  hasConversation: boolean
  userTurns: number
  onSubmit: (e: React.FormEvent) => void
  onFillChip: (chip: string) => void
  onClearChat: () => void
  onResetContext: () => void
  onViewStrategy: () => void
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-orange-600 shadow-[0_2px_8px_rgba(124,58,237,0.22)]">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-200/80 bg-white px-4 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function ErrorBubble({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-100">
        <Sparkles className="h-3.5 w-3.5 text-red-500" />
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 px-4 py-3.5">
        <p className="text-sm font-semibold text-red-800">Scout hit an error</p>
        <p className="mt-0.5 text-xs leading-5 text-red-600">{message}</p>
      </div>
    </div>
  )
}

function TodayFocusCard({
  board,
  isLoading,
  onViewStrategy,
}: {
  board: ScoutStrategyBoard | null
  isLoading: boolean
  onViewStrategy: () => void
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Today&apos;s Focus
          </p>
          <p className="mt-1 text-xs text-slate-500">What Scout is optimizing right now.</p>
        </div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50">
          <Target className="h-4 w-4 text-orange-600" />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {isLoading
          ? [1, 2, 3].map((i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded-xl bg-slate-100" />
            ))
          : (board?.todayFocus.slice(0, 3) ?? []).map((focus) => (
              <div
                key={focus}
                className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500" />
                <span className="text-[13px] leading-5 text-slate-700">{focus}</span>
              </div>
            ))}
        {!isLoading && (!board || board.todayFocus.length === 0) && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
            Ask Scout to build your first focus plan.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onViewStrategy}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 transition hover:bg-orange-100"
      >
        View Strategy
        <ChevronRight className="h-3 w-3" />
      </button>
    </article>
  )
}

function NextMovesRow({
  board,
  isLoading,
}: {
  board: ScoutStrategyBoard | null
  isLoading: boolean
}) {
  const moves = board?.nextMoves.slice(0, 3) ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Recommended Next Moves
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Fast actions to improve today&apos;s search.</p>
        </div>
        <button type="button" className="text-[11px] font-bold text-orange-600 hover:underline">
          View all
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {isLoading && moves.length === 0
          ? [1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
            ))
          : moves.map((move, idx) => (
              <div
                key={move.id}
                className="group flex min-h-[82px] items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
              >
                <div className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-orange-50 text-sm font-bold text-orange-700">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-900">{move.title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{move.description}</p>
                </div>
                <ArrowRight className="mt-2 h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-600" />
              </div>
            ))}
        {!isLoading && moves.length === 0 && (
          <p className="col-span-3 text-xs text-slate-400">
            No recommended moves yet — complete your profile and resume first.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ScoutOverviewTab({
  greeting,
  firstName,
  query,
  setQuery,
  isLoading,
  isCommandMode,
  setIsCommandMode,
  suggestionChips,
  messages,
  error,
  resumeRefreshedNotice,
  strategyBoard,
  strategyLoading,
  nudges,
  hasConversation,
  userTurns,
  onSubmit,
  onFillChip,
  onClearChat,
  onResetContext,
  onViewStrategy,
}: ScoutOverviewTabProps) {
  const { showUpgrade } = useUpgradeModal()
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const topNudges = nudges.slice(0, 3)

  return (
    <div className="space-y-6">
      {/* Page header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            {greeting}, {firstName} 👋
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Here&apos;s what Scout has for you today.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasConversation && (
            <button
              type="button"
              onClick={onClearChat}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              New chat
            </button>
          )}
          <button
            type="button"
            onClick={onResetContext}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </section>


      {/* Command row */}
      <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <form onSubmit={onSubmit}>
            <div className="min-h-[150px] rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                <Bot className="h-4 w-4 text-orange-600" />
                Ask Scout
              </div>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={hasConversation ? "Follow up…" : "Ask Scout anything…"}
                disabled={isLoading}
                rows={3}
                className="mt-4 w-full resize-none bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-50"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCommandMode((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                      isCommandMode
                        ? "border-orange-200 bg-orange-50 text-orange-700"
                        : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Command className="h-3 w-3" />
                    Command {isCommandMode ? "on" : "off"}
                  </button>
                  {suggestionChips.slice(0, 3).map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => onFillChip(chip)}
                      disabled={isLoading}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-40"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-40"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="hidden sm:inline">Ask</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        <TodayFocusCard
          board={strategyBoard}
          isLoading={strategyLoading}
          onViewStrategy={onViewStrategy}
        />
      </section>

      {/* Resume refreshed notice */}
      {resumeRefreshedNotice && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          <RefreshCw className="h-4 w-4 shrink-0" />
          Scout refreshed context for your updated resume.
        </div>
      )}


      {/* Chat thread */}
      {(hasConversation || isLoading || error) && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2 text-slate-500">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs font-bold">
                {userTurns === 0 ? "Conversation" : userTurns === 1 ? "1 message" : `${userTurns} messages`}
              </span>
            </div>
            {hasConversation && (
              <button
                type="button"
                onClick={onClearChat}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <RotateCcw className="h-3 w-3" />
                New conversation
              </button>
            )}
          </div>
          <div className="space-y-5 p-5">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-orange-600 px-4 py-3 text-sm leading-6 text-white shadow-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <ScoutMessageBubble key={msg.id} response={msg.response} onUpgrade={showUpgrade} />
              )
            )}
            {isLoading && <TypingIndicator />}
            {error && <ErrorBubble message={error} />}
            <div ref={chatEndRef} />
          </div>
        </section>
      )}

      {/* Top nudges */}
      {!hasConversation && !isLoading && topNudges.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Top Nudges</p>
              <p className="mt-0.5 text-xs text-slate-500">Small moves Scout thinks are worth your attention.</p>
            </div>
            <button type="button" className="text-[11px] font-bold text-orange-600 hover:underline">
              View all
            </button>
          </div>
          <TopNudgesGrid nudges={topNudges} />
        </section>
      )}

      {/* Next moves */}
      {!isLoading && (
        <section>
          <NextMovesRow board={strategyBoard} isLoading={strategyLoading} />
        </section>
      )}
    </div>
  )
}
