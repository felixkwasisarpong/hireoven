import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  applyCrawlQueuePolicy,
  classifyCrawlLane,
  defaultCrawlPolicyOptions,
  selectPolicyBatchByLaneShare,
  type CrawlCompanyLike,
  type CrawlSignal,
} from "./scheduling"

test("classifyCrawlLane: low-signal ATS requires repeated weak outcomes", () => {
  const company: CrawlCompanyLike = {
    id: "a",
    name: "A",
    careers_url: "https://foo.bamboohr.com/careers",
    last_crawled_at: null,
    ats_type: "bamboohr",
    job_count: 0,
  }

  const oneSignal: CrawlSignal[] = [
    {
      companyId: "a",
      status: "unchanged",
      errorMessage: null,
      crawledAt: "2026-05-10T00:00:00.000Z",
    },
  ]
  assert.equal(classifyCrawlLane(company, oneSignal[0], oneSignal), "ats_direct_possible")

  const repeatedSignals: CrawlSignal[] = [
    oneSignal[0],
    {
      companyId: "a",
      status: "unchanged",
      errorMessage: null,
      crawledAt: "2026-05-09T00:00:00.000Z",
    },
  ]
  assert.equal(classifyCrawlLane(company, repeatedSignals[0], repeatedSignals), "ats_low_signal")
})

test("applyCrawlQueuePolicy: deprioritizes repeated low-signal ATS companies", () => {
  const companies: CrawlCompanyLike[] = [
    {
      id: "bamboo",
      name: "Bamboo",
      careers_url: "https://foo.bamboohr.com/careers",
      last_crawled_at: "2026-05-10T00:00:00.000Z",
      ats_type: "bamboohr",
      job_count: 0,
    },
    {
      id: "gh",
      name: "Greenhouse",
      careers_url: "https://boards.greenhouse.io/acme",
      last_crawled_at: "2026-05-10T00:00:00.000Z",
      ats_type: "greenhouse",
      job_count: 0,
    },
    {
      id: "custom",
      name: "Custom",
      careers_url: "https://example.com/careers",
      last_crawled_at: "2026-05-10T00:00:00.000Z",
      ats_type: "custom",
      job_count: 12,
    },
  ]

  const signalMap = new Map<string, CrawlSignal[]>([
    [
      "bamboo",
      [
        {
          companyId: "bamboo",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-10T02:00:00.000Z",
        },
        {
          companyId: "bamboo",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-09T02:00:00.000Z",
        },
      ],
    ],
  ])

  const policy = applyCrawlQueuePolicy(companies, signalMap, defaultCrawlPolicyOptions())
  assert.deepEqual(policy.selected.map((row) => row.id), ["gh", "custom", "bamboo"])
  assert.equal(policy.selectedLaneCounts.ats_low_signal, 1)
})

test("selectPolicyBatchByLaneShare: reserves capacity for low-signal and likely-inactive lanes", () => {
  const companies: CrawlCompanyLike[] = [
    {
      id: "gh-1",
      name: "GH 1",
      careers_url: "https://boards.greenhouse.io/acme",
      last_crawled_at: "2026-05-08T00:00:00.000Z",
      ats_type: "greenhouse",
      job_count: 15,
    },
    {
      id: "gh-2",
      name: "GH 2",
      careers_url: "https://boards.greenhouse.io/bravo",
      last_crawled_at: "2026-05-09T00:00:00.000Z",
      ats_type: "greenhouse",
      job_count: 20,
    },
    {
      id: "general-1",
      name: "General",
      careers_url: "https://example.com/careers",
      last_crawled_at: "2026-05-07T00:00:00.000Z",
      ats_type: "custom",
      job_count: 9,
    },
    {
      id: "low-1",
      name: "Low 1",
      careers_url: "https://foo.bamboohr.com/careers",
      last_crawled_at: "2026-05-06T00:00:00.000Z",
      ats_type: "bamboohr",
      job_count: 0,
    },
    {
      id: "low-2",
      name: "Low 2",
      careers_url: "https://jobs.workable.com/foo",
      last_crawled_at: "2026-05-05T00:00:00.000Z",
      ats_type: "workable",
      job_count: 0,
    },
    {
      id: "inactive-1",
      name: "Inactive 1",
      careers_url: "https://inactive.example.com/jobs",
      last_crawled_at: "2026-05-04T00:00:00.000Z",
      ats_type: "custom",
      job_count: 0,
    },
    {
      id: "inactive-2",
      name: "Inactive 2",
      careers_url: "https://inactive2.example.com/jobs",
      last_crawled_at: "2026-05-03T00:00:00.000Z",
      ats_type: "custom",
      job_count: 0,
    },
  ]

  const signalMap = new Map<string, CrawlSignal[]>([
    [
      "low-1",
      [
        {
          companyId: "low-1",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-10T00:00:00.000Z",
        },
        {
          companyId: "low-1",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-09T00:00:00.000Z",
        },
      ],
    ],
    [
      "low-2",
      [
        {
          companyId: "low-2",
          status: "failed",
          errorMessage: null,
          crawledAt: "2026-05-10T00:00:00.000Z",
        },
        {
          companyId: "low-2",
          status: "failed",
          errorMessage: null,
          crawledAt: "2026-05-09T00:00:00.000Z",
        },
      ],
    ],
    [
      "inactive-1",
      [
        {
          companyId: "inactive-1",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    ],
    [
      "inactive-2",
      [
        {
          companyId: "inactive-2",
          status: "unchanged",
          errorMessage: null,
          crawledAt: "2026-05-09T00:00:00.000Z",
        },
      ],
    ],
  ])

  const policy = applyCrawlQueuePolicy(
    companies,
    signalMap,
    defaultCrawlPolicyOptions({
      includeLikelyInactive: true,
      bypassCooldown: true,
    })
  )

  const batch = selectPolicyBatchByLaneShare(policy, signalMap, 4, {
    likely_inactive: 0.25,
    ats_low_signal: 0.25,
  })

  assert.equal(batch.length, 4)
  assert(batch.some((row) => row.id === "low-1" || row.id === "low-2"))
  assert(batch.some((row) => row.id === "inactive-1" || row.id === "inactive-2"))
})
