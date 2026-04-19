"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { devError } from "@/lib/client-dev-log"
import { createClient } from "@/lib/supabase/client"
import type { Resume } from "@/types"

type ResumeContextValue = {
  resumes: Resume[]
  primaryResume: Resume | null
  hasResume: boolean
  isLoading: boolean
  processingCount: number
  refresh: () => Promise<void>
  upsertResume: (resume: Resume) => void
  removeResume: (resumeId: string) => void
}

const ResumeContext = createContext<ResumeContextValue | null>(null)

function sortResumes(resumes: Resume[]) {
  return [...resumes].sort((left, right) => {
    if (left.is_primary !== right.is_primary) {
      return left.is_primary ? -1 : 1
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })
}

export function ResumeProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [resumes, setResumes] = useState<Resume[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    if (!userId) {
      setResumes([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      devError("Failed to load resumes", error)
      setResumes([])
      setIsLoading(false)
      return
    }

    setResumes(sortResumes((data ?? []) as Resume[]))
    setIsLoading(false)
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const processingIds = resumes
      .filter((resume) => resume.parse_status === "processing")
      .map((resume) => resume.id)

    if (processingIds.length === 0) return

    const interval = window.setInterval(async () => {
      const statuses = await Promise.all(
        processingIds.map(async (id) => {
          const response = await fetch(`/api/resume/${id}/status`, { cache: "no-store" })
          if (!response.ok) return null
          return response.json() as Promise<{ parse_status: string }>
        })
      )

      if (
        statuses.some(
          (status) =>
            status?.parse_status === "complete" || status?.parse_status === "failed"
        )
      ) {
        await refresh()
      }
    }, 2_000)

    return () => window.clearInterval(interval)
  }, [refresh, resumes])

  const upsertResume = useCallback((resume: Resume) => {
    setResumes((current) => {
      const next = current.filter((item) => item.id !== resume.id)
      return sortResumes([resume, ...next])
    })
  }, [])

  const removeResume = useCallback((resumeId: string) => {
    setResumes((current) => current.filter((resume) => resume.id !== resumeId))
  }, [])

  const value = useMemo(() => {
    const primaryResume = resumes.find((resume) => resume.is_primary) ?? resumes[0] ?? null
    const processingCount = resumes.filter(
      (resume) => resume.parse_status === "processing"
    ).length

    return {
      resumes,
      primaryResume,
      hasResume: resumes.length > 0,
      isLoading,
      processingCount,
      refresh,
      upsertResume,
      removeResume,
    }
  }, [isLoading, refresh, removeResume, resumes, upsertResume])

  return (
    <ResumeContext.Provider value={value}>
      {children}
    </ResumeContext.Provider>
  )
}

export function useResumeContext() {
  const context = useContext(ResumeContext)

  if (!context) {
    throw new Error("useResumeContext must be used within ResumeProvider")
  }

  return context
}
