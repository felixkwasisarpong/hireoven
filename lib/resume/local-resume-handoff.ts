"use client"

import type { Resume } from "@/types"

const HANDOFF_KEY = "hireoven:uploaded-resume-handoff"
export const RESUME_HANDOFF_EVENT = "hireoven:uploaded-resume-handoff"
const HANDOFF_TTL_MS = 30 * 60 * 1000

type StoredResume = {
  resume: Resume
  savedAt: number
}

function isFresh(item: StoredResume) {
  return Date.now() - item.savedAt < HANDOFF_TTL_MS
}

export function readResumeHandoff() {
  if (typeof window === "undefined") return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(HANDOFF_KEY) ?? "[]") as StoredResume[]
    const fresh = Array.isArray(parsed) ? parsed.filter((item) => item?.resume?.id && isFresh(item)) : []
    if (fresh.length !== parsed.length) {
      window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(fresh))
    }
    return fresh.map((item) => item.resume)
  } catch {
    return []
  }
}

export function writeResumeHandoff(resume: Resume) {
  if (typeof window === "undefined") return

  const current = readResumeHandoff().filter((item) => item.id !== resume.id)
  const next: StoredResume[] = [
    { resume, savedAt: Date.now() },
    ...current.map((item) => ({ resume: item, savedAt: Date.now() })),
  ]
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(next.slice(0, 5)))
  window.dispatchEvent(new CustomEvent(RESUME_HANDOFF_EVENT, { detail: resume }))
}

export function removeResumeHandoff(resumeId: string) {
  if (typeof window === "undefined") return

  const next = readResumeHandoff()
    .filter((resume) => resume.id !== resumeId)
    .map((resume) => ({ resume, savedAt: Date.now() }))
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(RESUME_HANDOFF_EVENT))
}
