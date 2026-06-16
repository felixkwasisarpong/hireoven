"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { devWarn } from "@/lib/client-dev-log"
import { dedupeFeedJobsBySignature } from "@/lib/jobs/feed-dedupe"
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

function effectiveWithinForSort(filters: JobFilters): JobFilters["within"] {
  // Match/relevant sort (incl. Apex Focus Mode) caps the candidate set to a
  // recency window so scoring stays bounded. 24h was too tight: users with
  // narrow filters (specific titles + remote + sponsorship) routinely had zero
  // jobs in the last day and hit a dead-end empty feed. 7d keeps the feed
  // "recent" while giving those combinations room to surface matches.
  if (filters.sort === "match" || filters.sort === "relevant") return "7d"
  return filters.within
}

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
      (!job.sponsors_h1b &&
        ((job.sponsorship_score ?? 0) <= 60 ||
          /(^|\\.)dice\\.com/i.test(job.apply_url))))
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

  const hours = hoursFromWithin(effectiveWithinForSort(filters))
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

  if (filters.titles?.length) {
    const titleHaystack = `${job.title} ${job.normalized_title ?? ""}`.toLowerCase()
    const matchesAny = filters.titles.some((t) => {
      const needle = t.trim().toLowerCase()
      return needle.length > 0 && titleHaystack.includes(needle)
    })
    if (!matchesAny) return false
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

function sortJobs(rows: JobWithMatchScore[], filters: JobFilters, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase()

  function freshnessScore(timestamp: string) {
    const minutes = Math.max(
      1,
      Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
    )
    return Math.max(0, 500 - minutes)
  }

  function textScore(job: JobWithMatchScore) {
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
      // When real per-user match scores are present (server attached them
      // via withScores=1), sort primarily by overall_score. Falls back to
      // the synthetic freshness/text/sponsorship blend only when scores
      // are missing — typical for users without a primary resume.
      const leftMatch = left.match_score?.overall_score
      const rightMatch = right.match_score?.overall_score
      if (leftMatch != null || rightMatch != null) {
        const a = leftMatch ?? -1
        const b = rightMatch ?? -1
        if (a !== b) return b - a
        // tie-break on freshness
        return (
          new Date(right.first_detected_at).getTime() -
          new Date(left.first_detected_at).getTime()
        )
      }
      // Fallback synthetic match-ish score for users without resume scores.
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

function hasClientOnlyPersonalizedFilters(filters: JobFilters) {
  return Boolean(
    filters.visa_fit?.length ||
    filters.stem_opt_ready ||
    filters.e_verify_signal ||
    filters.cap_exempt_possible ||
    filters.lca_salary_aligned ||
    filters.ghost_risk_max
  )
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
  // When a refresh bails because another fetch is in-flight, we store it here
  // so the in-flight fetch can re-run it from its finally block.
  const pendingRefreshRef = useRef<(() => Promise<void>) | null>(null)

  function setAllJobs(jobs: JobWithMatchScore[]) {
    allJobsRef.current = jobs
    setAllJobsState(jobs)
  }

  /**
   * Always apply client sort. Server (`/api/match/feed`) and client now use
   * the same comparator for `sort=match` — pure `overall_score` DESC with
   * freshness as tie-break — so this is order-preserving for personalized
   * data and avoids a stale-order flash during sort transitions.
   */
  const jobs = useMemo(() => {
    return sortJobs(allJobs, filters, searchQuery).slice(0, visibleCount)
  }, [allJobs, visibleCount, filters, searchQuery])

  const fetchChunk = useCallback(
    async (offset: number) => {
      const chunkSize = searchQuery.trim() ? SEARCH_CHUNK_SIZE : PAGE_SIZE
      const requiresClientOnlyFiltering = hasClientOnlyPersonalizedFilters(filters)
      const effectiveWithin = effectiveWithinForSort(filters)

      if (personalized) {
        const params = new URLSearchParams()
        if (searchQuery.trim()) params.set("q", searchQuery.trim())
        if (passRemoteToJobsApi(filters)) params.set("remote", "true")
        if (filters.hybrid) params.set("hybrid", "true")
        if (filters.onsite) params.set("onsite", "true")
        if (filters.sponsorship) params.set("sponsorship", "true")
        if (filters.seniority?.length) params.set("seniority", filters.seniority.join(","))
        if (filters.employment_type?.length) {
          params.set("employment", filters.employment_type.join(","))
        }
        if (filters.company_ids?.length) params.set("companies", filters.company_ids.join(","))
        if (effectiveWithin && effectiveWithin !== "all") params.set("within", effectiveWithin)
        // Tell the server when we're in Best Match — it drops the saved-jobs
        // UNION in that mode so the surface stays "fresh fit only".
        if (filters.sort === "match") params.set("sort", "match")
        if (filters.locationQuery?.trim()) {
          params.set("location", filters.locationQuery.trim())
        }
        if (filters.min_salary != null && filters.min_salary > 0) {
          params.set("minSalary", String(filters.min_salary))
        }
        if (filters.skills?.length) params.set("skills", filters.skills.join(","))
        if (filters.titles?.length) params.set("titles", filters.titles.join(","))
        if (filters.industryQuery?.trim()) params.set("industry", filters.industryQuery.trim())
        if (filters.hide_blockers) params.set("hideBlockers", "true")
        if (filters.has_salary) params.set("hasSalary", "true")
        if (filters.direct_ats_only) params.set("directAtsOnly", "true")
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
        const list = requiresClientOnlyFiltering
          ? all.filter((job) => matchesClientFilters(job, filters, searchQuery))
          : all
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
      if (effectiveWithin && effectiveWithin !== "all") params.set("within", effectiveWithin)
      if (filters.titles?.length) params.set("titles", filters.titles.join(","))
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

      if (loadingRef.current) {
        // Signal the in-flight fetch to abort (requestKey mismatch) and queue
        // this request to run once the in-flight fetch releases loadingRef.
        requestKeyRef.current = requestKey
        pendingRefreshRef.current = () => ensureVisibleJobs(targetVisible, reset)
        return
      }

      pendingRefreshRef.current = null
      requestKeyRef.current = requestKey
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

            const merged = dedupeFeedJobsBySignature([...nextRows, ...rows])

            // Client-side sorting is applied in the `jobs` memo, so the merged
            // list here can stay unsorted — pagination order is reapplied
            // before render anyway.
            nextRows = merged

            // Fast first paint: after a filter/reset, swap the list to the first
            // chunk immediately instead of waiting for additional chunks. We do
            // *not* clear allJobs before the fetch (see `refresh`), so until this
            // line runs the user keeps seeing the previous results.
            if (reset && chunksFetched === 1) {
              setAllJobs(nextRows)
              setVisibleCount(Math.min(targetVisible, nextRows.length))
              setHasMore(!exhausted || nextRows.length > targetVisible)
            }

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
        // If a newer refresh was queued while this fetch ran, execute it now.
        const pending = pendingRefreshRef.current
        if (pending) {
          pendingRefreshRef.current = null
          void pending()
        }
      }
    },
    [fetchChunk, filters, personalized, searchQuery]
  )

  const refresh = useCallback(async () => {
    offsetRef.current = 0
    exhaustedRef.current = false
    setHasMore(true)
    // Keep the previous list visible while the new fetch runs so filter/sort
    // changes don't flash an empty skeleton — `ensureVisibleJobs` atomically
    // replaces the list when the first chunk lands.
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
