"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { devWarn } from "@/lib/client-dev-log"
import {
  matchesLocationFilter,
  matchesSearchQuery,
} from "@/lib/jobs/search-match"
import { getJobIntelligence } from "@/lib/jobs/intelligence"
import type { JobFilters, JobWithCompany, JobWithMatchScore } from "@/types"

const GHOST_RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, unknown: 3 }

const PAGE_SIZE = 20
const SEARCH_CHUNK_SIZE = 80
/** Avoid unbounded Supabase round-trips when client-side filters discard most rows. */
const MAX_FETCH_CHUNKS = 14

function hoursFromWithin(within: JobFilters["within"]) {
  if (within === "1h") return 1
  if (within === "6h") return 6
  if (within === "24h") return 24
  if (within === "3d") return 72
  if (within === "7d") return 168
  return null
}

function matchesSearch(job: JobWithCompany, query: string) {
  if (
    matchesSearchQuery(
      [
        job.title,
        job.normalized_title,
        job.location,
        job.company?.name,
        job.company?.domain,
        job.skills?.join(" "),
        job.description,
      ],
      query
    )
  ) {
    return true
  }

  return matchesLocationFilter(job.location, query, {
    isRemote: job.is_remote,
  })
}

function matchesClientFilters(job: JobWithCompany, filters: JobFilters, query: string) {
  const workAny = filters.remote || filters.hybrid || filters.onsite
  if (workAny) {
    const ok =
      (Boolean(filters.remote) && job.is_remote) ||
      (Boolean(filters.hybrid) && job.is_hybrid) ||
      (Boolean(filters.onsite) && !job.is_remote && !job.is_hybrid)
    if (!ok) return false
  }

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

  if (filters.locationQuery?.trim()) {
    if (
      !matchesLocationFilter(
        job.location,
        filters.locationQuery,
        { isRemote: job.is_remote }
      )
    ) {
      return false
    }
  }

  if (filters.min_salary != null && filters.min_salary > 0) {
    const min = filters.min_salary
    if (job.salary_max != null && job.salary_max < min) return false
  }

  const hours = hoursFromWithin(filters.within)
  if (hours) {
    const ageMs = Date.now() - new Date(job.first_detected_at).getTime()
    if (ageMs > hours * 3_600_000) return false
  }

  if (filters.skills?.length) {
    const haystack = [
      ...(job.skills ?? []),
      job.title,
      job.normalized_title ?? "",
      job.description ?? "",
    ]
      .join(" ")
      .toLowerCase()
    for (const token of filters.skills) {
      const t = token.trim().toLowerCase()
      if (!t) continue
      if (!haystack.includes(t)) return false
    }
  }

  if (filters.industryQuery?.trim()) {
    const needle = filters.industryQuery.trim().toLowerCase()
    const industry = job.company?.industry?.toLowerCase() ?? ""
    if (!industry.includes(needle)) return false
  }

  // --- Advanced / intelligence-based filters ---
  if (filters.hide_blockers && job.requires_authorization) return false

  if (filters.has_salary && job.salary_min == null && job.salary_max == null) return false

  if (filters.direct_ats_only) {
    const ats = job.company?.ats_type
    if (!ats || ats === "custom") return false
  }

  // Intelligence-dependent filters — computed lazily (cheap fallback when not stored)
  const hasIntelFilter =
    filters.visa_fit?.length ||
    filters.stem_opt_ready ||
    filters.e_verify_signal ||
    filters.cap_exempt_possible ||
    filters.lca_salary_aligned ||
    filters.ghost_risk_max

  if (hasIntelFilter) {
    const intel = getJobIntelligence(job)

    if (filters.visa_fit?.length) {
      const label = intel.visa?.label ?? "Unknown"
      if (!filters.visa_fit.includes(label as never)) return false
    }

    if (filters.stem_opt_ready) {
      const stemEligible =
        intel.stemOpt?.eligible || intel.stemOpt?.eVerifyLikely
      if (!stemEligible) return false
    }

    if (filters.e_verify_signal) {
      if (!intel.stemOpt?.eVerifyLikely) return false
    }

    if (filters.cap_exempt_possible) {
      if (!intel.capExempt?.isLikelyCapExempt) return false
    }

    if (filters.lca_salary_aligned) {
      if (intel.lcaSalary?.comparisonLabel !== "Aligned") return false
    }

    if (filters.ghost_risk_max) {
      const jobRisk = (intel.ghostJobRisk?.riskLevel ?? "unknown").toLowerCase()
      const maxRisk = filters.ghost_risk_max
      if ((GHOST_RISK_ORDER[jobRisk] ?? 3) > (GHOST_RISK_ORDER[maxRisk] ?? 1)) return false
    }
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

/** Only narrow the API with `remote=true` when remote is the sole work-mode filter */
function passRemoteToJobsApi(filters: JobFilters) {
  return Boolean(filters.remote) && !filters.hybrid && !filters.onsite
}

type UseJobsOptions = {
  personalized?: boolean
  withScores?: boolean
}

export function useJobs(
  filters: JobFilters = {},
  searchQuery = "",
  options: UseJobsOptions = {}
) {
  const personalized = Boolean(options.personalized)
  const withScores = Boolean(options.withScores)
  const [allJobs, setAllJobsState] = useState<JobWithMatchScore[]>([])
  const allJobsRef = useRef<JobWithMatchScore[]>([])
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

  function setAllJobs(jobs: JobWithMatchScore[]) {
    allJobsRef.current = jobs
    setAllJobsState(jobs)
  }

  const jobs = useMemo(
    () => allJobs.slice(0, visibleCount),
    [allJobs, visibleCount]
  )

  const fetchChunk = useCallback(
    async (offset: number) => {
      const chunkSize = searchQuery.trim() ? SEARCH_CHUNK_SIZE : PAGE_SIZE

      if (personalized) {
        const params = new URLSearchParams()
        if (searchQuery.trim()) params.set("q", searchQuery.trim())
        if (passRemoteToJobsApi(filters)) params.set("remote", "true")
        if (filters.sponsorship) params.set("sponsorship", "true")
        if (filters.seniority?.length) params.set("seniority", filters.seniority.join(","))
        if (filters.employment_type?.length) {
          params.set("employment", filters.employment_type.join(","))
        }
        if (filters.company_ids?.length) params.set("companies", filters.company_ids.join(","))
        if (filters.within && filters.within !== "all") params.set("within", filters.within)
        if (filters.locationQuery?.trim()) {
          params.set("location", filters.locationQuery.trim())
        }
        params.set("limit", String(chunkSize))
        params.set("offset", String(offset))

        const response = await fetch(`/api/match/feed?${params.toString()}`, {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error("Failed to load personalized jobs")
        }

        const payload = (await response.json()) as {
          jobs?: JobWithMatchScore[]
          total?: number
          newInLastHour?: number
        }

        const all = payload.jobs ?? []
        const list = all.filter((job) =>
          matchesClientFilters(job, filters, searchQuery)
        )
        return {
          rows: list,
          /** Keep offset in sync with server batch size, not after client-side filtering */
          rawCount: all.length,
          totalCount: payload.total ?? null,
          lastHourCount: payload.newInLastHour ?? 0,
        }
      }

      const params = new URLSearchParams()
      if (searchQuery.trim()) params.set("q", searchQuery.trim())
      if (passRemoteToJobsApi(filters)) params.set("remote", "true")
      if (filters.sponsorship) params.set("sponsorship", "true")
      if (filters.seniority?.length) params.set("seniority", filters.seniority.join(","))
      if (filters.employment_type?.length) params.set("employment_type", filters.employment_type.join(","))
      if (filters.company_ids?.length) params.set("company_id", filters.company_ids[0])
      if (filters.within && filters.within !== "all") params.set("within", filters.within)
      if (withScores) params.set("withScores", "1")
      params.set("limit", String(chunkSize))
      params.set("offset", String(offset))

      const response = await fetch(`/api/jobs?${params}`, { cache: "no-store" })
      if (!response.ok) throw new Error("Failed to fetch jobs")

      const payload = (await response.json()) as {
        jobs?: JobWithCompany[]
        total?: number
        newInLastHour?: number
      }
      const data = (payload.jobs ?? []) as JobWithCompany[]

      return {
        rows: data.filter((job) => matchesClientFilters(job, filters, searchQuery)),
        rawCount: data.length,
        totalCount: payload.total ?? null,
        lastHourCount: null,
      }
    },
    [filters, personalized, searchQuery, withScores]
  )

  const ensureVisibleJobs = useCallback(
    async (targetVisible: number, reset = false) => {
      const requestKey = JSON.stringify({ filters, searchQuery })
      requestKeyRef.current = requestKey

      if (loadingRef.current) return
      loadingRef.current = true
      setIsLoading(true)

      try {
        let nextRows = reset ? [] : allJobsRef.current
        let nextOffset = reset ? 0 : offsetRef.current
        let exhausted = reset ? false : exhaustedRef.current
        const chunkSize = searchQuery.trim() ? SEARCH_CHUNK_SIZE : PAGE_SIZE

        let chunksFetched = 0
        while (
          nextRows.length < targetVisible &&
          !exhausted &&
          chunksFetched < MAX_FETCH_CHUNKS
        ) {
          chunksFetched += 1
          try {
            const {
              rows,
              rawCount,
              totalCount: exactCount,
              lastHourCount: exactLastHourCount,
            } = await fetchChunk(nextOffset)

            if (requestKeyRef.current !== requestKey) return

            nextOffset += rawCount
            if (rawCount < chunkSize) exhausted = true

            const merged = [...nextRows, ...rows].filter(
              (job, index, collection) =>
                collection.findIndex((item) => item.id === job.id) === index
            )

            nextRows = personalized ? merged : sortJobs(merged, filters, searchQuery)

            if (exactCount !== null) {
              setTotalCount(exactCount)
            }

            if (rawCount === 0) exhausted = true

            if (personalized && exactLastHourCount !== null) {
              setLastHourCount(exactLastHourCount)
            }
          } catch (error) {
            devWarn("Job feed fetch failed", error)
            exhausted = true
            break
          }
        }

        if (chunksFetched >= MAX_FETCH_CHUNKS && nextRows.length < targetVisible) {
          exhausted = true
        }

        offsetRef.current = nextOffset
        exhaustedRef.current = exhausted
        setAllJobs(nextRows)
        setVisibleCount(Math.min(targetVisible, nextRows.length))
        setHasMore(!exhausted || nextRows.length > targetVisible)
        if (!personalized) {
          setLastHourCount(countLastHour(nextRows))
          if (searchQuery.trim()) setTotalCount(nextRows.length)
        }
        if (reset) setNewJobsCount(0)
      } finally {
        if (requestKeyRef.current === requestKey) {
          setIsLoading(false)
        }
        loadingRef.current = false
      }
    },
    [fetchChunk, filters, personalized, searchQuery]
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
    const currentLen = allJobsRef.current.length
    if (currentLen >= target || exhaustedRef.current) {
      setVisibleCount((current) => Math.min(current + PAGE_SIZE, currentLen))
      setHasMore(!exhaustedRef.current || currentLen > target)
      return
    }

    await ensureVisibleJobs(target)
  }, [ensureVisibleJobs, visibleCount])


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
