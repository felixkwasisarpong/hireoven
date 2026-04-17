"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Job, JobFilters, JobWithCompany } from "@/types"

const PAGE_SIZE = 20
const SEARCH_CHUNK_SIZE = 80

function hoursFromWithin(within: JobFilters["within"]) {
  if (within === "1h") return 1
  if (within === "6h") return 6
  if (within === "24h") return 24
  if (within === "3d") return 72
  return null
}

function matchesSearch(job: JobWithCompany, query: string) {
  if (!query.trim()) return true

  const needle = query.trim().toLowerCase()
  const haystack = [
    job.title,
    job.normalized_title,
    job.location,
    job.company?.name,
    job.company?.domain,
    job.skills?.join(" "),
    job.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(needle)
}

function matchesClientFilters(job: JobWithCompany, filters: JobFilters, query: string) {
  if (filters.remote && !job.is_remote) return false

  if (
    filters.sponsorship &&
    (job.requires_authorization ||
      (!job.sponsors_h1b && (job.sponsorship_score ?? 0) <= 60))
  ) {
    return false
  }

  if (
    filters.seniority?.length &&
    (!job.seniority_level || !filters.seniority.includes(job.seniority_level))
  ) {
    return false
  }

  if (
    filters.employment_type?.length &&
    (!job.employment_type ||
      !filters.employment_type.includes(job.employment_type))
  ) {
    return false
  }

  if (filters.company_ids?.length && !filters.company_ids.includes(job.company_id))
    return false

  const hours = hoursFromWithin(filters.within)
  if (hours) {
    const ageMs = Date.now() - new Date(job.first_detected_at).getTime()
    if (ageMs > hours * 3_600_000) return false
  }

  return matchesSearch(job, query)
}

function sortJobs(rows: JobWithCompany[], filters: JobFilters, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase()

  function freshnessScore(timestamp: string) {
    const minutes = Math.max(
      1,
      Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
    )
    return Math.max(0, 500 - minutes)
  }

  function textScore(job: JobWithCompany) {
    if (!query) return 0

    const title = `${job.title} ${job.normalized_title ?? ""}`.toLowerCase()
    const company = job.company?.name.toLowerCase() ?? ""
    const location = job.location?.toLowerCase() ?? ""
    const skills = job.skills?.join(" ").toLowerCase() ?? ""

    let score = 0
    if (title === query) score += 80
    else if (title.startsWith(query)) score += 55
    else if (title.includes(query)) score += 40
    if (company.includes(query)) score += 28
    if (skills.includes(query)) score += 22
    if (location.includes(query)) score += 12
    return score
  }

  return [...rows].sort((left, right) => {
    if (filters.sort === "match") {
      const leftScore =
        freshnessScore(left.first_detected_at) +
        textScore(left) +
        (left.sponsors_h1b ? 28 : 0) +
        ((left.sponsorship_score ?? 0) > 60 ? 10 : 0) +
        (left.is_remote ? 8 : 0)
      const rightScore =
        freshnessScore(right.first_detected_at) +
        textScore(right) +
        (right.sponsors_h1b ? 28 : 0) +
        ((right.sponsorship_score ?? 0) > 60 ? 10 : 0) +
        (right.is_remote ? 8 : 0)
      if (rightScore !== leftScore) return rightScore - leftScore
    }

    if (filters.sort === "relevant") {
      const leftScore = textScore(left) * 3 + freshnessScore(left.first_detected_at)
      const rightScore = textScore(right) * 3 + freshnessScore(right.first_detected_at)
      if (rightScore !== leftScore) return rightScore - leftScore
    }

    return (
      new Date(right.first_detected_at).getTime() -
      new Date(left.first_detected_at).getTime()
    )
  })
}

function countLastHour(rows: JobWithCompany[]) {
  const cutoff = Date.now() - 3_600_000
  return rows.filter(
    (job) => new Date(job.first_detected_at).getTime() >= cutoff
  ).length
}

export function useJobs(filters: JobFilters = {}, searchQuery = "") {
  const [allJobs, setAllJobs] = useState<JobWithCompany[]>([])
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [lastHourCount, setLastHourCount] = useState(0)
  const [newJobsCount, setNewJobsCount] = useState(0)

  const offsetRef = useRef(0)
  const exhaustedRef = useRef(false)
  const loadingRef = useRef(false)
  const requestKeyRef = useRef("")

  const jobs = useMemo(
    () => allJobs.slice(0, visibleCount),
    [allJobs, visibleCount]
  )

  const fetchChunk = useCallback(
    async (offset: number) => {
      const supabase = createClient()
      const chunkSize = searchQuery.trim() ? SEARCH_CHUNK_SIZE : PAGE_SIZE

      let query = (supabase
        .from("jobs")
        .select("*, company:companies(*)", {
          count: searchQuery.trim() ? undefined : "exact",
        })
        .eq("is_active", true)
        .order("first_detected_at", { ascending: false })
        .range(offset, offset + chunkSize - 1) as any)

      if (filters.remote) query = query.eq("is_remote", true)
      if (filters.seniority?.length)
        query = query.in("seniority_level", filters.seniority)
      if (filters.employment_type?.length)
        query = query.in("employment_type", filters.employment_type)
      if (filters.company_ids?.length)
        query = query.in("company_id", filters.company_ids)

      const hours = hoursFromWithin(filters.within)
      if (hours) {
        query = query.gte(
          "first_detected_at",
          new Date(Date.now() - hours * 3_600_000).toISOString()
        )
      }

      if (filters.sponsorship) {
        query = query.or("sponsors_h1b.eq.true,sponsorship_score.gt.60")
      }

      const { data, error, count } = await query

      if (error) throw error

      return {
        rows: ((data ?? []) as JobWithCompany[]).filter((job) =>
          matchesClientFilters(job, filters, searchQuery)
        ),
        rawCount: (data ?? []).length,
        totalCount: count ?? null,
      }
    },
    [filters, searchQuery]
  )

  const ensureVisibleJobs = useCallback(
    async (targetVisible: number, reset = false) => {
      const requestKey = JSON.stringify({ filters, searchQuery })
      requestKeyRef.current = requestKey

      if (loadingRef.current) return
      loadingRef.current = true
      setIsLoading(true)

      try {
        let nextRows = reset ? [] : allJobs
        let nextOffset = reset ? 0 : offsetRef.current
        let exhausted = reset ? false : exhaustedRef.current
        const chunkSize = searchQuery.trim() ? SEARCH_CHUNK_SIZE : PAGE_SIZE

        while (nextRows.length < targetVisible && !exhausted) {
          const { rows, rawCount, totalCount: exactCount } = await fetchChunk(nextOffset)

          if (requestKeyRef.current !== requestKey) return

          nextOffset += rawCount
          if (rawCount < chunkSize) exhausted = true

          const merged = [...nextRows, ...rows].filter(
            (job, index, collection) =>
              collection.findIndex((item) => item.id === job.id) === index
          )

          nextRows = sortJobs(merged, filters, searchQuery)

          if (!searchQuery.trim() && exactCount !== null) {
            setTotalCount(exactCount)
          }

          if (rawCount === 0) exhausted = true
        }

        offsetRef.current = nextOffset
        exhaustedRef.current = exhausted
        setAllJobs(nextRows)
        setVisibleCount(Math.min(targetVisible, nextRows.length))
        setHasMore(!exhausted || nextRows.length > targetVisible)
        setLastHourCount(countLastHour(nextRows))
        if (searchQuery.trim()) setTotalCount(nextRows.length)
        if (reset) setNewJobsCount(0)
      } finally {
        if (requestKeyRef.current === requestKey) {
          setIsLoading(false)
        }
        loadingRef.current = false
      }
    },
    [allJobs, fetchChunk, filters, searchQuery]
  )

  const refresh = useCallback(async () => {
    offsetRef.current = 0
    exhaustedRef.current = false
    setAllJobs([])
    setVisibleCount(PAGE_SIZE)
    setHasMore(true)
    await ensureVisibleJobs(PAGE_SIZE, true)
  }, [ensureVisibleJobs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadMore = useCallback(async () => {
    const target = visibleCount + PAGE_SIZE
    if (allJobs.length >= target || exhaustedRef.current) {
      setVisibleCount((current) => Math.min(current + PAGE_SIZE, allJobs.length))
      setHasMore(!exhaustedRef.current || allJobs.length > target)
      return
    }

    await ensureVisibleJobs(target)
  }, [allJobs.length, ensureVisibleJobs, visibleCount])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`jobs-feed-${JSON.stringify(filters)}-${searchQuery}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "jobs" },
        (payload) => {
          const row = payload.new as Job
          const roughMatch =
            (!filters.remote || row.is_remote) &&
            (!filters.sponsorship ||
              (row.sponsors_h1b || (row.sponsorship_score ?? 0) > 60)) &&
            (!filters.seniority?.length ||
              (row.seniority_level &&
                filters.seniority.includes(row.seniority_level))) &&
            (!filters.employment_type?.length ||
              (row.employment_type &&
                filters.employment_type.includes(row.employment_type))) &&
            (!filters.company_ids?.length ||
              filters.company_ids.includes(row.company_id)) &&
            (!searchQuery.trim() ||
              [
                row.title,
                row.normalized_title,
                row.location,
                row.skills?.join(" "),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(searchQuery.trim().toLowerCase()))

          if (roughMatch) setNewJobsCount((current) => current + 1)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [filters, searchQuery])

  return {
    jobs,
    isLoading,
    hasMore,
    loadMore,
    totalCount,
    lastHourCount,
    newJobsCount,
    refresh,
  }
}
