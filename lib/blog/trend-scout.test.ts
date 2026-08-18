import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { BlogCategory } from "@/types/blog"
import {
  MIN_NOVELTY,
  isDuplicateOfRecent,
  selectTrend,
  type RecentPostDigest,
  type TrendCandidate,
} from "./trend-scout"

const CATEGORIES = [
  { slug: "h1b-visa-intel", name: "H1B & Visa Intel" },
  { slug: "job-market-pulse", name: "Job Market Pulse" },
  { slug: "career-strategy", name: "Career Strategy" },
] as unknown as BlogCategory[]

const candidate = (over: Partial<TrendCandidate> = {}): TrendCandidate => ({
  categorySlug: "h1b-visa-intel",
  headline: "USCIS moves the H-1B registration window to March 3",
  whyNow: "Announced this morning in a Federal Register notice.",
  noveltyScore: 80,
  sources: ["https://federalregister.gov/…"],
  ...over,
})

const post = (title: string, categorySlug = "h1b-visa-intel"): RecentPostDigest => ({
  title,
  excerpt: null,
  categorySlug,
  createdAt: "2026-08-16T00:00:00.000Z",
})

test("picks the highest-novelty eligible candidate regardless of category", () => {
  const result = selectTrend(
    [
      candidate({ categorySlug: "career-strategy", headline: "Resume tips for autumn", noveltyScore: 58 }),
      candidate({ categorySlug: "job-market-pulse", headline: "Big Tech posts 12% fewer roles in Q3", noveltyScore: 91 }),
    ],
    CATEGORIES,
    [],
  )
  assert.equal(result.status, "found")
  if (result.status !== "found") return
  assert.equal(result.candidate.categorySlug, "job-market-pulse")
  assert.equal(result.candidate.noveltyScore, 91)
})

test("returns nothing_trending rather than forcing a post on a quiet day", () => {
  const result = selectTrend([], CATEGORIES, [])
  assert.equal(result.status, "nothing_trending")
  if (result.status !== "nothing_trending") return
  assert.match(result.reason, /no developments/i)
})

test("evergreen filler below the novelty bar is rejected", () => {
  const result = selectTrend(
    [candidate({ headline: "H-1B remains competitive", noveltyScore: MIN_NOVELTY - 1 })],
    CATEGORIES,
    [],
  )
  assert.equal(result.status, "nothing_trending")
  if (result.status !== "nothing_trending") return
  assert.match(result.reason, /novelty bar/i)
})

test("a candidate repeating a recent post is rejected even with high novelty", () => {
  const recent = [post("USCIS moves the H-1B registration window to March 3")]
  const result = selectTrend([candidate({ noveltyScore: 99 })], CATEGORIES, recent)
  assert.equal(result.status, "nothing_trending")
  if (result.status !== "nothing_trending") return
  assert.match(result.reason, /repeats a recent post/i)
})

test("falls through to the next candidate when the best one is a repeat", () => {
  const recent = [post("USCIS moves the H-1B registration window to March 3")]
  const fresh = candidate({
    categorySlug: "job-market-pulse",
    headline: "Amazon freezes hiring across three org units",
    noveltyScore: 70,
  })
  const result = selectTrend([candidate({ noveltyScore: 99 }), fresh], CATEGORIES, recent)
  assert.equal(result.status, "found")
  if (result.status !== "found") return
  assert.equal(result.candidate.headline, fresh.headline)
})

test("a candidate filed under an unknown category is not published", () => {
  const result = selectTrend(
    [candidate({ categorySlug: "made-up-section", noveltyScore: 95 })],
    CATEGORIES,
    [],
  )
  assert.equal(result.status, "nothing_trending")
  if (result.status !== "nothing_trending") return
  assert.match(result.reason, /unknown category/i)
})

test("isDuplicateOfRecent ignores short filler words", () => {
  const recent = [post("The H-1B lottery is now weighted by wage level")]
  assert.equal(
    isDuplicateOfRecent(
      candidate({ headline: "H-1B lottery weighted wage level" }),
      recent,
    ),
    true,
  )
  assert.equal(
    isDuplicateOfRecent(
      candidate({ headline: "Nvidia announces 400 new roles in Austin" }),
      recent,
    ),
    false,
  )
})

test("considered list is returned sorted for observability", () => {
  const result = selectTrend(
    [candidate({ noveltyScore: 60 }), candidate({ headline: "Other", noveltyScore: 95 })],
    CATEGORIES,
    [],
  )
  assert.equal(result.considered[0]?.noveltyScore, 95)
  assert.equal(result.considered[1]?.noveltyScore, 60)
})
