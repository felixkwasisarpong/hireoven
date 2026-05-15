import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool, QueryResult } from "pg"
import type { HarvestedJob } from "@/lib/harvester/adapters"
import { persistJobsBulk } from "./persist-bulk"

type CapturedCall = { text: string; values: unknown[] }

function makeFakePool(rowsByQuery: Array<QueryResult["rows"]>) {
  const captured: CapturedCall[] = []
  let call = 0
  const pool = {
    query: async (text: string, values: unknown[]) => {
      captured.push({ text, values })
      const rows = rowsByQuery[call] ?? []
      call += 1
      return { rows, rowCount: rows.length } as unknown as QueryResult
    },
  } as unknown as Pool
  return { pool, captured }
}

function makeJob(overrides: Partial<HarvestedJob> = {}): HarvestedJob {
  return {
    externalId: "greenhouse:1",
    title: "Senior Backend Engineer",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    description: "We are hiring.",
    location: "San Francisco, CA",
    postedAt: "2026-05-10T12:00:00.000Z",
    contentHash: "0123456789abcdef0123456789abcdef",
    ...overrides,
  }
}

test("persistJobsBulk: single ON CONFLICT upsert with content_hash short-circuit", async () => {
  const { pool, captured } = makeFakePool([
    [{ inserted: true }, { inserted: false }],
    [],
  ])

  const outcome = await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000001",
    companyMeta: { name: "Acme", domain: "acme.com", careersUrl: "https://boards.greenhouse.io/acme" },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-11T00:00:00.000Z"),
    jobs: [
      makeJob({ externalId: "greenhouse:1" }),
      makeJob({
        externalId: "greenhouse:2",
        title: "Staff Engineer",
        applyUrl: "https://boards.greenhouse.io/acme/jobs/2",
        contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      makeJob({
        externalId: "greenhouse:3",
        title: "Engineering Manager",
        applyUrl: "https://boards.greenhouse.io/acme/jobs/3",
        contentHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ],
  })

  assert.equal(captured.length, 2, "expected one upsert + one company-count update")
  const upsert = captured[0]
  assert.match(upsert.text, /INSERT INTO jobs/)
  assert.match(upsert.text, /ON CONFLICT \(company_id, external_id\)/)
  assert.match(upsert.text, /WHERE jobs\.content_hash IS DISTINCT FROM EXCLUDED\.content_hash/)
  assert.match(upsert.text, /jsonb_array_elements\(\$5::jsonb\)/)
  assert.match(upsert.text, /RETURNING \(xmax = 0\) AS inserted/)
  assert.equal(upsert.values[0], "00000000-0000-0000-0000-000000000001")
  assert.equal(upsert.values[2], "greenhouse")
  assert.equal(upsert.values[3], "acme")

  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  assert.equal(payload.length, 3)
  assert.equal(payload[0].external_id, "greenhouse:1")
  assert.equal(payload[0].content_hash, "0123456789abcdef0123456789abcdef")
  assert.ok(payload[0].raw_data)

  // 2 returned rows (one insert, one update), 3 input → 1 unchanged.
  assert.equal(outcome.inserted, 1)
  assert.equal(outcome.updated, 1)
  assert.equal(outcome.unchanged, 1)
  assert.equal(outcome.written, 2)
  assert.equal(outcome.inputCount, 3)
  assert.equal(outcome.filteredOut, 0)

  const companyUpdate = captured[1]
  assert.match(companyUpdate.text, /UPDATE companies/)
  assert.match(companyUpdate.text, /job_count/)
  assert.match(companyUpdate.text, /last_crawled_at/)
})

test("persistJobsBulk: filters blocked titles and dedupes by externalId", async () => {
  const { pool, captured } = makeFakePool([[], []])

  const outcome = await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000002",
    companyMeta: { name: "Acme", domain: null, careersUrl: null },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-11T00:00:00.000Z"),
    jobs: [
      makeJob({ externalId: "greenhouse:dup", title: "Engineer", contentHash: "1".repeat(32) }),
      makeJob({ externalId: "greenhouse:dup", title: "Engineer v2", contentHash: "2".repeat(32) }),
      makeJob({ externalId: "greenhouse:login", title: "Login", contentHash: "3".repeat(32) }),
    ],
  })

  const upsert = captured[0]
  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  assert.equal(payload.length, 1, "duplicate externalId collapsed, blocked title filtered")
  assert.equal(payload[0].external_id, "greenhouse:dup")
  assert.equal(payload[0].title, "Engineer v2", "latest payload wins on dedupe")

  assert.equal(outcome.inputCount, 3)
  assert.equal(outcome.filteredOut, 2)
})

test("persistJobsBulk: empty input still updates company job_count", async () => {
  const { pool, captured } = makeFakePool([])

  const outcome = await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000003",
    companyMeta: { name: "Acme", domain: null, careersUrl: null },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-11T00:00:00.000Z"),
    jobs: [],
  })

  assert.equal(captured.length, 1)
  assert.match(captured[0].text, /UPDATE companies/)
  assert.equal(outcome.inserted, 0)
  assert.equal(outcome.updated, 0)
  assert.equal(outcome.unchanged, 0)
  assert.equal(outcome.written, 0)
  assert.equal(outcome.inputCount, 0)
})

test("persistJobsBulk: normalizes relative postedAt and drops unparseable values", async () => {
  const { pool, captured } = makeFakePool([[], []])
  const crawledAt = new Date("2026-05-11T00:00:00.000Z")

  await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000004",
    companyMeta: { name: "Acme", domain: null, careersUrl: null },
    sourceAts: "workday",
    sourceAtsSlug: "acme:wd1:External",
    crawledAt,
    jobs: [
      makeJob({
        externalId: "workday:1",
        postedAt: "Posted Today",
        contentHash: "4".repeat(32),
      }),
      makeJob({
        externalId: "workday:2",
        postedAt: "Soon-ish",
        contentHash: "5".repeat(32),
      }),
    ],
  })

  const upsert = captured[0]
  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  assert.equal(payload.length, 2)
  assert.equal(payload[0].posted_at, "2026-05-11T00:00:00.000Z")
  assert.equal(payload[1].posted_at, null)
})
