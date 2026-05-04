"use client"

/**
 * Scout Memory Panel
 *
 * Lets users inspect, edit, disable, and delete their persistent Scout memories.
 * Rendered as a right-side drawer over the Scout workspace.
 *
 * Design principles:
 *   - Full transparency: every memory is visible
 *   - Every action is instant and reversible (disable vs delete)
 *   - No dark patterns — user is always in control
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Brain, X, Trash2, EyeOff, Eye, Plus, RefreshCw } from "lucide-react"
import {
  MEMORY_CATEGORY_LABELS,
  MEMORY_CATEGORY_ICONS,
  VALID_MEMORY_CATEGORIES,
  type ScoutMemory,
  type ScoutMemoryCategory,
} from "@/lib/scout/memory/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  onClose: () => void
}

type EditingState = {
  id:      string
  summary: string
}

// ── Confidence label ──────────────────────────────────────────────────────────

function confidenceLabel(c: number): { label: string; color: string } {
  if (c >= 0.9) return { label: "Stated",     color: "text-emerald-600 bg-emerald-50 border-emerald-200" }
  if (c >= 0.75) return { label: "Confirmed", color: "text-blue-600 bg-blue-50 border-blue-200" }
  if (c >= 0.6)  return { label: "Inferred",  color: "text-amber-600 bg-amber-50 border-amber-200" }
  return              { label: "Weak",        color: "text-slate-500 bg-slate-50 border-slate-200" }
}

function sourceLabel(s: ScoutMemory["source"]): string {
  switch (s) {
    case "explicit_user": return "You said this"
    case "behavior":      return "From your activity"
    case "workflow":      return "From a workflow"
    case "search_history": return "From your searches"
  }
}

// ── Inline edit form ──────────────────────────────────────────────────────────

function MemoryRow({
  memory,
  onToggle,
  onDelete,
  onSaveEdit,
}: {
  memory:      ScoutMemory
  onToggle:    (id: string, active: boolean) => void
  onDelete:    (id: string) => void
  onSaveEdit:  (id: string, summary: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(memory.summary)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const handleSave = () => {
    const trimmed = draft.trim()
    if (trimmed.length >= 4) onSaveEdit(memory.id, trimmed)
    setEditing(false)
  }

  const conf = confidenceLabel(memory.confidence)
  const icon = MEMORY_CATEGORY_ICONS[memory.category] ?? "🧠"

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        memory.active
          ? "border-slate-200 bg-white"
          : "border-slate-100 bg-slate-50 opacity-60"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Category icon */}
        <span className="mt-0.5 text-base flex-shrink-0" aria-hidden="true">
          {icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Category + confidence */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {MEMORY_CATEGORY_LABELS[memory.category]}
            </span>
            <span className={`text-[10px] font-medium border rounded-full px-2 py-px ${conf.color}`}>
              {conf.label}
            </span>
            {!memory.active && (
              <span className="text-[10px] font-medium border rounded-full px-2 py-px bg-slate-100 text-slate-400 border-slate-200">
                Disabled
              </span>
            )}
          </div>

          {/* Summary — editable */}
          {editing ? (
            <div className="mt-1">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                maxLength={300}
                className="w-full text-sm text-slate-800 border border-blue-300 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={handleSave}
                  className="text-xs font-semibold text-white bg-[#FF5C18] hover:bg-[#e0511a] rounded-lg px-3 py-1 transition"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDraft(memory.summary); setEditing(false) }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-slate-700 text-left w-full hover:text-slate-900 transition leading-snug"
              title="Click to edit"
            >
              {memory.summary}
            </button>
          )}

          {/* Source */}
          <p className="text-[10px] text-slate-400 mt-1">{sourceLabel(memory.source)}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          <button
            onClick={() => onToggle(memory.id, !memory.active)}
            title={memory.active ? "Disable — Scout won't use this" : "Re-enable"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            {memory.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            title="Delete permanently"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add memory form ───────────────────────────────────────────────────────────

function AddMemoryForm({ onAdd }: { onAdd: (category: ScoutMemoryCategory, summary: string) => void }) {
  const [open,     setOpen]     = useState(false)
  const [category, setCategory] = useState<ScoutMemoryCategory>("role_preference")
  const [summary,  setSummary]  = useState("")

  const handleSubmit = () => {
    if (summary.trim().length < 4) return
    onAdd(category, summary.trim())
    setSummary("")
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-semibold text-slate-400 hover:border-[#FF5C18] hover:text-[#FF5C18] transition"
      >
        <Plus className="h-3.5 w-3.5" />
        Add memory manually
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-[#FF5C18]/30 bg-orange-50/40 p-3 space-y-2.5">
      <div className="text-xs font-semibold text-slate-600">New memory</div>

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as ScoutMemoryCategory)}
        className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#FF5C18]/30"
      >
        {[...VALID_MEMORY_CATEGORIES].map((c) => (
          <option key={c} value={c}>
            {MEMORY_CATEGORY_ICONS[c]} {MEMORY_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>

      <textarea
        placeholder="e.g. Prefers platform engineering at Series B–D startups"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        maxLength={300}
        className="w-full text-xs border border-slate-200 rounded-lg p-2 resize-none bg-white text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF5C18]/30"
      />

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={summary.trim().length < 4}
          className="text-xs font-semibold text-white bg-[#FF5C18] hover:bg-[#e0511a] disabled:opacity-40 rounded-lg px-3 py-1.5 transition"
        >
          Save
        </button>
        <button
          onClick={() => { setSummary(""); setOpen(false) }}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ScoutMemoryPanel({ onClose }: Props) {
  const [memories,    setMemories]    = useState<ScoutMemory[]>([])
  const [loading,     setLoading]     = useState(true)
  const [extracting,  setExtracting]  = useState(false)
  const [extractedN,  setExtractedN]  = useState<number | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/scout/memory")
      if (!res.ok) throw new Error("Failed to load memories")
      const data = (await res.json()) as { memories: ScoutMemory[] }
      setMemories(data.memories)
    } catch {
      // Fail silently — table may not exist yet or user may be unauthenticated
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Extract from activity ────────────────────────────────────────────────
  const handleExtract = async () => {
    setExtracting(true)
    setExtractedN(null)
    try {
      const res = await fetch("/api/scout/memory/extract", { method: "POST" })
      const data = (await res.json()) as { extracted: number }
      setExtractedN(data.extracted)
      if (data.extracted > 0) void load()
    } catch {
      // ignore — not critical
    } finally {
      setExtracting(false)
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const handleAdd = async (category: ScoutMemoryCategory, summary: string) => {
    const res = await fetch("/api/scout/memory", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ category, summary, confidence: 1.0, source: "explicit_user" }),
    })
    if (res.ok) {
      const data = (await res.json()) as { memory: ScoutMemory }
      setMemories((prev) => [data.memory, ...prev])
    }
  }

  const handleToggle = async (id: string, active: boolean) => {
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, active } : m)))
    await fetch(`/api/scout/memory/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ active }),
    })
  }

  const handleDelete = async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id))
    await fetch(`/api/scout/memory/${id}`, { method: "DELETE" })
  }

  const handleSaveEdit = async (id: string, summary: string) => {
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, summary } : m)))
    await fetch(`/api/scout/memory/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ summary }),
    })
  }

  const handleDisableAll = async () => {
    if (!confirm("Disable all memories? Scout won't use them until you re-enable them.")) return
    setMemories((prev) => prev.map((m) => ({ ...m, active: false })))
    await Promise.all(
      memories
        .filter((m) => m.active)
        .map((m) =>
          fetch(`/api/scout/memory/${m.id}`, {
            method:  "PATCH",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ active: false }),
          }),
        ),
    )
  }

  // ── Groups ───────────────────────────────────────────────────────────────
  const active   = memories.filter((m) => m.active)
  const inactive = memories.filter((m) => !m.active)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl border-l border-slate-200 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#FF5C18]/10 flex items-center justify-center flex-shrink-0">
              <Brain className="h-4 w-4 text-[#FF5C18]" />
            </div>
            <div>
              <div className="text-sm font-700 text-slate-900 font-bold">Scout Memory</div>
              <div className="text-[10px] text-slate-400">
                {memories.length === 0 ? "No memories yet" : `${active.length} active · ${memories.length} total`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            aria-label="Close memory panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Privacy notice */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <p className="text-[10.5px] text-slate-500 leading-relaxed">
            Scout uses these to personalise recommendations across sessions.{" "}
            <strong className="text-slate-600">You control everything here.</strong>{" "}
            Edit, disable, or delete any memory at any time.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Extract button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${extracting ? "animate-spin" : ""}`} />
              {extracting ? "Scanning activity…" : "Scan my activity"}
            </button>
            {extractedN !== null && (
              <span className="text-xs text-slate-500">
                {extractedN > 0 ? `+${extractedN} added` : "Nothing new found"}
              </span>
            )}
          </div>

          {/* Add form */}
          <AddMemoryForm onAdd={handleAdd} />

          {/* Loading */}
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}

          {/* Active memories */}
          {!loading && active.length > 0 && (
            <div className="space-y-2">
              {active.map((m) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onSaveEdit={handleSaveEdit}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && memories.length === 0 && (
            <div className="py-8 text-center space-y-2">
              <Brain className="h-8 w-8 text-slate-200 mx-auto" />
              <p className="text-sm font-medium text-slate-400">No memories yet</p>
              <p className="text-xs text-slate-300">
                Scout will learn from your conversations. Click "Scan my activity" to get started.
              </p>
            </div>
          )}

          {/* Disabled memories */}
          {!loading && inactive.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300 pt-2">
                Disabled ({inactive.length})
              </div>
              {inactive.map((m) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onSaveEdit={handleSaveEdit}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {memories.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 flex-shrink-0">
            <button
              onClick={handleDisableAll}
              className="text-xs text-slate-400 hover:text-red-500 transition"
            >
              Disable all memories
            </button>
          </div>
        )}
      </div>
    </>
  )
}
