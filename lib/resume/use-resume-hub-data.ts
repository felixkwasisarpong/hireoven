"use client"

import { useCallback, useEffect, useState } from "react"
import type { ResumeHubData } from "@/types/resume-hub"

const EMPTY_HUB_DATA: ResumeHubData = {
  recentEdits: [],
  resumeMeta: {},
  targetJobs: [],
  tailoringAnalyses: [],
  profile: null,
}

export function useResumeHubData() {
  const [data, setData] = useState<ResumeHubData>(EMPTY_HUB_DATA)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch("/api/resume/hub", {
      credentials: "include",
      cache: "no-store",
    })

    if (!response.ok) {
      setData(EMPTY_HUB_DATA)
      setIsLoading(false)
      return
    }

    setData((await response.json()) as ResumeHubData)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Re-fetch whenever any part of the app signals a resume change
  useEffect(() => {
    function onResumeChange() { void refresh() }
    window.addEventListener("hireoven:resumes-changed", onResumeChange)
    return () => window.removeEventListener("hireoven:resumes-changed", onResumeChange)
  }, [refresh])

  return { data, isLoading, refresh }
}
