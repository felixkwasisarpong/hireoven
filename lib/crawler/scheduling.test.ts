import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  applyCrawlQueuePolicy,
  classifyCrawlLane,
  defaultCrawlPolicyOptions,
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
