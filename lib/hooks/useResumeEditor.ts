"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { devError } from "@/lib/client-dev-log"
import { applyResumeEditContent } from "@/lib/resume/state"
import type {
  Resume,
  ResumeEditContext,
  ResumeEditSuggestion,
  ResumeSection,
} from "@/types"

type SaveState = "idle" | "saving" | "saved" | "error"

function buildPayload(resume: Resume) {
  return {
    summary: resume.summary,
    work_experience: resume.work_experience,
    education: resume.education,
    skills: resume.skills,
    projects: resume.projects,
  }
}

function serializePayload(resume: Resume) {
  return JSON.stringify(buildPayload(resume))
}

export function useResumeEditor(initialResume: Resume) {
  const [resume, setResume] = useState(initialResume)
  const [suggestions, setSuggestions] = useState<ResumeEditSuggestion[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<Resume[]>([])
  const [redoStack, setRedoStack] = useState<Resume[]>([])
  const [retryTick, setRetryTick] = useState(0)
  const lastSavedRef = useRef(serializePayload(initialResume))

  useEffect(() => {
    setResume(initialResume)
    lastSavedRef.current = serializePayload(initialResume)
    setUndoStack([])
    setRedoStack([])
    setSuggestions([])
    setSaveState("idle")
    setLastSavedAt(initialResume.updated_at ?? null)
  }, [initialResume])

  const pushUndo = useCallback((snapshot: Resume) => {
    setUndoStack((current) => [...current.slice(-19), snapshot])
    setRedoStack([])
  }, [])

  const updateSection = useCallback(
    (section: ResumeSection, content: unknown, context?: ResumeEditContext | null) => {
      setResume((current) => {
        pushUndo(current)
        return applyResumeEditContent(current, section, content, context)
      })
      setSaveState("idle")
    },
    [pushUndo]
  )

  const queueSuggestion = useCallback((suggestion: ResumeEditSuggestion) => {
    setSuggestions((current) => {
      const next = current.filter((item) => item.id !== suggestion.id)
      return [suggestion, ...next]
    })
  }, [])

  const acceptSuggestion = useCallback(
    async (editId: string) => {
      const suggestion = suggestions.find((item) => item.id === editId)
      if (!suggestion) return null

      setIsSaving(true)
      const response = await fetch("/api/resume/edit/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editId,
          section: suggestion.section,
          content: suggestion.suggested_content,
          context: suggestion.context,
        }),
      })

      const data = await response.json()
      setIsSaving(false)

      if (!response.ok) {
        setSaveState("error")
        throw new Error(data.error ?? "Failed to accept suggestion")
      }

      setResume(data as Resume)
      lastSavedRef.current = serializePayload(data as Resume)
      setLastSavedAt((data as Resume).updated_at)
      setSaveState("saved")
      setSuggestions((current) => current.filter((item) => item.id !== editId))
      return data as Resume
    },
    [suggestions]
  )

  const rejectSuggestion = useCallback(async (editId: string, feedback?: string) => {
    const response = await fetch("/api/resume/edit/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editId, feedback }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error ?? "Failed to reject suggestion")
    }

    setSuggestions((current) => current.filter((item) => item.id !== editId))
  }, [])

  const undo = useCallback(() => {
    setUndoStack((current) => {
      const previous = current[current.length - 1]
      if (!previous) return current
      setRedoStack((redo) => [...redo.slice(-19), resume])
      setResume(previous)
      setSaveState("idle")
      return current.slice(0, -1)
    })
  }, [resume])

  const redo = useCallback(() => {
    setRedoStack((current) => {
      const next = current[current.length - 1]
      if (!next) return current
      setUndoStack((undoState) => [...undoState.slice(-19), resume])
      setResume(next)
      setSaveState("idle")
      return current.slice(0, -1)
    })
  }, [resume])

  const isDirty = useMemo(
    () => serializePayload(resume) !== lastSavedRef.current,
    [resume]
  )

  useEffect(() => {
    if (!isDirty) return

    const timeout = window.setTimeout(async () => {
      setIsSaving(true)
      setSaveState("saving")

      try {
        const response = await fetch(`/api/resume/${resume.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(resume)),
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to save resume")
        }

        setResume(data as Resume)
        lastSavedRef.current = serializePayload(data as Resume)
        setLastSavedAt((data as Resume).updated_at)
        setSaveState("saved")
      } catch (error) {
        devError("Resume autosave failed", error)
        setSaveState("error")
        window.setTimeout(() => setRetryTick((current) => current + 1), 3000)
      } finally {
        setIsSaving(false)
      }
    }, 2000)

    return () => window.clearTimeout(timeout)
  }, [isDirty, resume, retryTick])

  return {
    resume,
    suggestions,
    isSaving,
    isDirty,
    saveState,
    lastSavedAt,
    updateSection,
    queueSuggestion,
    setSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }
}
