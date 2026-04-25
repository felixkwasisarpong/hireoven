"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Mail,
  MessageSquare,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react"
import {
  generateRecruiterMessages,
  type GeneratedMessage,
  type MessageTone,
  type RecruiterMessageInput,
  type RecruiterMessageStage,
  type UserImmigrationStage,
} from "@/lib/recruiter/message-generator"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const Z_TOP = 2147483647
const WHITE: React.CSSProperties = { backgroundColor: "#ffffff" }

const STATUS_OPTIONS: { value: UserImmigrationStage; label: string }[] = [
  { value: "opt", label: "OPT" },
  { value: "stem_opt", label: "STEM OPT" },
  { value: "h1b_current", label: "H-1B (current)" },
  { value: "needs_future_h1b", label: "Needs future H-1B" },
  { value: "citizen_gc", label: "Citizen / Green Card" },
  { value: "unknown", label: "Prefer not to say" },
]

const TONE_OPTIONS: { value: MessageTone; label: string }[] = [
  { value: "concise", label: "Concise" },
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
]

const CHANNEL_LABELS: { id: "body" | "linkedInVersion" | "shortVersion"; label: string; icon: React.ElementType }[] = [
  { id: "body", label: "Email", icon: Mail },
  { id: "linkedInVersion", label: "LinkedIn", icon: MessageSquare },
  { id: "shortVersion", label: "Short", icon: Sparkles },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  open: boolean
  onClose: () => void
  jobTitle: string
  company: string
  /** Pre-populate from user's saved visa status if available */
  defaultStatus?: UserImmigrationStage
  /** Pre-select a template stage if triggered from a specific context */
  defaultStage?: RecruiterMessageStage
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition",
        copied
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {copied ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Copy className="h-3 w-3" aria-hidden />
      )}
      {copied ? "Copied!" : "Copy"}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

export default function RecruiterMessageDrawer({
  open,
  onClose,
  jobTitle,
  company,
  defaultStatus = "unknown",
  defaultStage = "before_applying",
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<UserImmigrationStage>(defaultStatus)
  const [tone, setTone] = useState<MessageTone>("concise")
  const [recruiterName, setRecruiterName] = useState("")
  const [activeStage, setActiveStage] = useState<RecruiterMessageStage>(defaultStage)
  const [activeChannel, setActiveChannel] = useState<"body" | "linkedInVersion" | "shortVersion">("body")
  const [editMode, setEditMode] = useState(false)
  const [editedBody, setEditedBody] = useState("")

  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Sync defaultStatus when prop changes (e.g. after profile load)
  useEffect(() => {
    setStatus(defaultStatus)
  }, [defaultStatus])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Reset edit mode when stage/channel changes
  useEffect(() => {
    setEditMode(false)
  }, [activeStage, activeChannel])

  const input: RecruiterMessageInput = {
    userStatus: status,
    jobTitle,
    company,
    recruiterName: recruiterName || null,
    tone,
  }

  const messages = generateRecruiterMessages(input)
  const activeMsg = messages.find((m) => m.id === activeStage) ?? messages[0]
  const rawText = activeMsg[activeChannel]
  const displayText = editMode ? editedBody : rawText

  function handleStartEdit() {
    setEditedBody(rawText)
    setEditMode(true)
  }

  function handleResetEdit() {
    setEditMode(false)
    setEditedBody("")
  }

  if (!mounted) return null

  const drawer = (
    <div
      style={{ position: "fixed", inset: 0, zIndex: Z_TOP, pointerEvents: open ? "auto" : "none" }}
      aria-hidden={!open}
    >
      {/* Backdrop — semi-transparent, closes drawer on click */}
      <div
        className={cn(
          "absolute inset-0 bg-black/20 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recruiter message generator"
        style={{
          ...WHITE,
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(520px, 100vw)",
          zIndex: Z_TOP,
          boxShadow: "-8px 0 40px rgba(0,0,0,0.12)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={WHITE}
          className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 px-5 py-4"
        >
          <div>
            <p className="text-[13px] font-bold text-slate-900">Message Recruiter</p>
            <p className="mt-0.5 text-[11px] text-slate-500 truncate max-w-[340px]">
              {jobTitle} · {company}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Personalization ── */}
          <section className="space-y-3">
            <SectionLabel>Personalize</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-500" htmlFor="rm-status">
                  Your status
                </label>
                <div className="relative">
                  <select
                    id="rm-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as UserImmigrationStage)}
                    className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-500" htmlFor="rm-tone">
                  Tone
                </label>
                <div className="relative">
                  <select
                    id="rm-tone"
                    value={tone}
                    onChange={(e) => setTone(e.target.value as MessageTone)}
                    className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    {TONE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-500" htmlFor="rm-name">
                Recruiter name <span className="text-slate-400">(optional)</span>
              </label>
              <input
                id="rm-name"
                type="text"
                placeholder="e.g. Sarah"
                value={recruiterName}
                onChange={(e) => setRecruiterName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* ── Template picker ── */}
          <section className="space-y-2">
            <SectionLabel>Template</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {messages.map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => setActiveStage(msg.id)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-left text-[11.5px] font-medium ring-1 transition",
                    activeStage === msg.id
                      ? "bg-blue-50 text-blue-800 ring-blue-200"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                  )}
                >
                  {msg.label}
                </button>
              ))}
            </div>
            {activeMsg && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {activeMsg.description}
              </p>
            )}
          </section>

          <div className="border-t border-slate-100" />

          {/* ── Channel tabs ── */}
          <section className="space-y-3">
            <div className="flex items-center gap-1">
              {CHANNEL_LABELS.map((ch) => {
                const Icon = ch.icon
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannel(ch.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition",
                      activeChannel === ch.id
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {ch.label}
                  </button>
                )
              })}
            </div>

            {/* Subject line (email only) */}
            {activeChannel === "body" && activeMsg.subject && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/60">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subject</p>
                <p className="mt-0.5 text-[12px] text-slate-700">{activeMsg.subject}</p>
              </div>
            )}

            {/* Message body / editable textarea */}
            <div className="relative">
              {editMode ? (
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={12}
                  className="w-full rounded-lg border border-blue-300 bg-white px-3 py-3 text-[12px] leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
                />
              ) : (
                <div className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-3 text-[12px] leading-relaxed text-slate-700 ring-1 ring-slate-200/60 min-h-[120px]">
                  {displayText}
                </div>
              )}
            </div>

            {/* Action row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {editMode ? (
                  <button
                    type="button"
                    onClick={handleResetEdit}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden />
                    Reset
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    <Edit3 className="h-3 w-3" aria-hidden />
                    Edit
                  </button>
                )}
              </div>
              <CopyButton text={displayText} />
            </div>
          </section>

          {/* ── Disclaimer ── */}
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-amber-100">
            <p className="text-[11px] leading-relaxed text-amber-800">
              <span className="font-semibold">Reminder:</span> Review and edit before sending.
              These are starting points — adapt to your voice. This is not legal advice.
            </p>
          </div>

          {/* Bottom padding for scroll */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )

  return createPortal(drawer, document.body)
}
