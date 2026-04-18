"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ApplicationStatus, JobApplication, PipelineStats, TimelineEntry } from "@/types"

type ApplicationsGrouped = Record<ApplicationStatus, JobApplication[]>

const STATUSES: ApplicationStatus[] = [
  "saved", "applied", "phone_screen", "interview", "final_round", "offer", "rejected", "withdrawn",
]

function emptyGrouped(): ApplicationsGrouped {
  const entries = STATUSES.map((s) => [s, [] as JobApplication[]])
  return Object.fromEntries(entries) as ApplicationsGrouped
}

export function useApplications() {
  const [applications, setApplications] = useState<JobApplication[]>([])
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const g = emptyGrouped()
    for (const app of applications) {
      if (g[app.status]) g[app.status].push(app)
      else g[app.status] = [app]
    }
    return g
  }, [applications])

  const fetchAll = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [appsRes, statsRes] = await Promise.all([
        fetch("/api/applications"),
        fetch("/api/applications/stats"),
      ])
      if (!appsRes.ok) throw new Error("Failed to load applications")
      const { applications: data } = await appsRes.json()
      setApplications(data ?? [])
      if (statsRes.ok) {
        const s = await statsRes.json()
        setStats(s)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const moveApplication = useCallback(async (id: string, newStatus: ApplicationStatus) => {
    // Optimistic update
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus, updated_at: new Date().toISOString() } : a))
    )
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error("Update failed")
      const { application } = await res.json()
      setApplications((prev) => prev.map((a) => (a.id === id ? application : a)))
    } catch {
      // Revert
      fetchAll()
    }
  }, [fetchAll])

  const addApplication = useCallback(async (payload: {
    companyName: string
    jobTitle: string
    status?: ApplicationStatus
    jobId?: string
    applyUrl?: string
    matchScore?: number
    companyLogoUrl?: string
    source?: string
  }) => {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error ?? "Failed to create application")
    }
    const { application } = await res.json()
    setApplications((prev) => [application, ...prev])
    return application as JobApplication
  }, [])

  const updateApplication = useCallback(async (id: string, updates: Partial<JobApplication>) => {
    // Optimistic
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates, updated_at: new Date().toISOString() } : a))
    )
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error("Update failed")
      const { application } = await res.json()
      setApplications((prev) => prev.map((a) => (a.id === id ? application : a)))
      return application as JobApplication
    } catch {
      fetchAll()
      throw new Error("Update failed")
    }
  }, [fetchAll])

  const deleteApplication = useCallback(async (id: string) => {
    setApplications((prev) => prev.filter((a) => a.id !== id))
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
    } catch {
      fetchAll()
    }
  }, [fetchAll])

  const addTimelineEntry = useCallback(async (
    applicationId: string,
    entry: { type?: string; note?: string; date?: string }
  ) => {
    const res = await fetch(`/api/applications/${applicationId}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    })
    if (!res.ok) throw new Error("Failed to add entry")
    const { entry: newEntry, timeline } = await res.json()
    setApplications((prev) =>
      prev.map((a) => (a.id === applicationId ? { ...a, timeline } : a))
    )
    return newEntry as TimelineEntry
  }, [])

  const removeTimelineEntry = useCallback(async (applicationId: string, entryId: string) => {
    const res = await fetch(`/api/applications/${applicationId}/timeline?entryId=${entryId}`, {
      method: "DELETE",
    })
    if (!res.ok) throw new Error("Failed to remove entry")
    setApplications((prev) =>
      prev.map((a) =>
        a.id === applicationId
          ? { ...a, timeline: a.timeline.filter((e) => e.id !== entryId) }
          : a
      )
    )
  }, [])

  return {
    applications,
    grouped,
    stats,
    isLoading,
    error,
    refresh: fetchAll,
    moveApplication,
    addApplication,
    updateApplication,
    deleteApplication,
    addTimelineEntry,
    removeTimelineEntry,
  }
}
