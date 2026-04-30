"use client"

import { RefreshCw, Sparkles } from "lucide-react"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { ScoutResponse, ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutNudge } from "@/lib/scout/nudges"

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

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
  chatEndRef: React.RefObject<HTMLDivElement>
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
        <Sparkles className="h-3.5 w-3.5 text-white" />
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
  chatEndRef,
}: Props) {
  const { showUpgrade } = useUpgradeModal()
  const hasConversation = messages.length > 0

  return (
    <div className="space-y-6">
      {/* Resume refreshed notice */}
      {resumeRefreshedNotice && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          Scout refreshed context for your updated resume.
        </div>
      )}

      {/* Empty state — greeting + nudges */}
      {!hasConversation && !isLoading && (
        <div>
          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-gray-950">
              {greeting}, {firstName}.
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              What are you working on today?
            </p>
          </div>

          {/* Nudges */}
          {!strategyLoading && nudges.length > 0 && (
            <div className="space-y-2">
              {nudges.slice(0, 3).map((nudge, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4"
                >
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF5C18]" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{nudge.title}</p>
                    {nudge.description && (
                      <p className="mt-0.5 text-xs text-gray-500">{nudge.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Zero-state illustration */}
          {!strategyLoading && nudges.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center">
              <div className="relative mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF5C18] shadow-[0_8px_24px_rgba(255,92,24,0.35)]">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Scout is ready</p>
              <p className="mt-1 text-xs text-gray-400">
                Use the command bar above to search jobs, compare roles, tailor your resume, and more.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Conversation thread */}
      {hasConversation && (
        <div className="space-y-4">
          {/* Clear button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClearChat}
              className="text-xs text-gray-400 transition hover:text-gray-700"
            >
              Clear conversation
            </button>
          </div>

          {messages.map((msg) =>
            msg.role === "user" ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#FF5C18] px-4 py-3 text-sm leading-5 text-white shadow-[0_4px_12px_rgba(255,92,24,0.22)]">
                  {msg.text}
                </div>
              </div>
            ) : (
              <ScoutMessageBubble
                key={msg.id}
                response={msg.response}
                compact={false}
                onUpgrade={showUpgrade}
              />
            )
          )}

          {isLoading && <TypingIndicator />}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      )}

      {/* Loading without messages */}
      {!hasConversation && isLoading && (
        <TypingIndicator />
      )}
    </div>
  )
}
