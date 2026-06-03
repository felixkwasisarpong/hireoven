import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Pool, QueryResult } from "pg"
import type { HarvestedJob } from "@/lib/harvester/adapters"
import { persistJobsBulk } from "./persist-bulk"

type CapturedCall = { text: string; values: unknown[] }

function makeFakePool(
  rowsByQuery: Array<QueryResult["rows"]>,
  options: { existingRows?: QueryResult["rows"]; captureExistingQuery?: boolean } = {}
) {
  const captured: CapturedCall[] = []
  let call = 0
  const pool = {
    query: async (text: string, values: unknown[]) => {
      if (/SELECT\s+external_id,\s*description,/i.test(text)) {
        if (options.captureExistingQuery) captured.push({ text, values })
        const rows = options.existingRows ?? []
        return { rows, rowCount: rows.length } as unknown as QueryResult
      }
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

  assert.equal(captured.length, 3, "expected upsert + stale-scan + company-count update")
  const upsert = captured[0]
  assert.match(upsert.text, /INSERT INTO jobs/)
  assert.match(upsert.text, /ON CONFLICT \(company_id, external_id\)/)
  assert.match(upsert.text, /WHERE jobs\.content_hash IS DISTINCT FROM EXCLUDED\.content_hash/)
  assert.match(
    upsert.text,
    /description\s*=\s*COALESCE\(NULLIF\(EXCLUDED\.description,\s*''\),\s*jobs\.description\)/
  )
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

  const staleScan = captured[1]
  assert.match(staleScan.text, /SELECT id, external_id, last_seen_at/)
  assert.match(staleScan.text, /source_ats = \$2/)
  assert.match(staleScan.text, /source_ats_slug = \$3/)

  const companyUpdate = captured[2]
  assert.match(companyUpdate.text, /UPDATE companies/)
  assert.match(companyUpdate.text, /job_count/)
  assert.match(companyUpdate.text, /last_crawled_at/)
})

test("persistJobsBulk: filters blocked titles and dedupes by externalId", async () => {
  const { pool, captured } = makeFakePool([[], [], []])

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

test("persistJobsBulk: splits large payloads into batches of HARVESTER_PERSIST_BATCH_SIZE", async () => {
  // 950 jobs with batch=400 should produce 3 upsert calls + 1 company-count update.
  process.env.HARVESTER_PERSIST_BATCH_SIZE = "400"
  // Re-import the module so the constant picks up the new env value.
  delete require.cache[require.resolve("./persist-bulk")]
  const { persistJobsBulk: chunkedPersist } = await import("./persist-bulk")

  const upsertResponses: Array<Array<{ inserted: boolean }>> = [
    Array.from({ length: 400 }, () => ({ inserted: true })),
    Array.from({ length: 400 }, () => ({ inserted: true })),
    Array.from({ length: 150 }, () => ({ inserted: true })),
    [],
    [],
  ]
  const { pool, captured } = makeFakePool(upsertResponses)

  const jobs: HarvestedJob[] = Array.from({ length: 950 }, (_, i) =>
    makeJob({
      externalId: `greenhouse:${i}`,
      title: `Engineer ${i}`,
      applyUrl: `https://boards.greenhouse.io/acme/jobs/${i}`,
      contentHash: i.toString(16).padStart(32, "0"),
    })
  )

  const outcome = await chunkedPersist({
    pool,
    companyId: "00000000-0000-0000-0000-000000000099",
    companyMeta: { name: "Acme", domain: "acme.com", careersUrl: null },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-19T00:00:00.000Z"),
    jobs,
  })

  // 3 upsert chunks + stale scan + 1 company-count update.
  assert.equal(captured.length, 5, `expected 5 calls, got ${captured.length}`)
  const sizes = captured.slice(0, 3).map((c) => JSON.parse(c.values[4] as string).length)
  assert.deepEqual(sizes, [400, 400, 150])
  assert.equal(outcome.inserted, 950)
  assert.equal(outcome.written, 950)
  assert.equal(outcome.unchanged, 0)

  delete process.env.HARVESTER_PERSIST_BATCH_SIZE
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
  const { pool, captured } = makeFakePool([[], [], []])
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

test("persistJobsBulk: salvages substantive adapter descriptions when strict normalizer drops them", async () => {
  const { pool, captured } = makeFakePool([[], [], []])

  await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000005",
    companyMeta: { name: "Acme", domain: null, careersUrl: null },
    sourceAts: "lever",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-11T00:00:00.000Z"),
    jobs: [
      makeJob({
        externalId: "lever:salvage-1",
        description:
          "RESPONSIBILITIES\nBuild backend services and operate production APIs across multiple teams with strong ownership and collaboration mindset",
        contentHash: "6".repeat(32),
      }),
    ],
  })

  const upsert = captured[0]
  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  assert.equal(payload.length, 1)
  assert.equal(
    payload[0].description,
    "RESPONSIBILITIES\nBuild backend services and operate production APIs across multiple teams with strong ownership and collaboration mindset"
  )
})

test("persistJobsBulk: normalizes from existing description when incoming adapter description is useless", async () => {
  const existingDescription =
    "Senior platform engineering role owning CI/CD systems, GitHub Actions, internal developer tooling, LLM integrations, RAG knowledge systems, and AI-assisted code review standards for a large engineering organization."
  const { pool, captured } = makeFakePool(
    [[{ inserted: false }], [], []],
    {
      captureExistingQuery: true,
      existingRows: [
        {
          external_id: "workday:geico:R0064342",
          description: existingDescription,
          employment_type: null,
          seniority_level: "staff",
          is_remote: false,
          is_hybrid: false,
          requires_authorization: false,
          salary_min: null,
          salary_max: null,
          salary_currency: "USD",
          sponsors_h1b: null,
          sponsorship_score: 60,
          visa_language_detected: null,
        },
      ],
    }
  )

  await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000055",
    companyMeta: { name: "GEICO", domain: "geico.com", careersUrl: null },
    sourceAts: "workday",
    sourceAtsSlug: "geico:wd1:External",
    crawledAt: new Date("2026-06-03T00:00:00.000Z"),
    jobs: [
      makeJob({
        externalId: "workday:geico:R0064342",
        title: "Senior Staff Software Engineer - Developer Experience",
        applyUrl: "https://geico.wd1.myworkdayjobs.com/en-US/External/job/Palo-Alto-CA/Senior-Staff-Software-Engineer---Developer-Experience_R0064342",
        description: "R0064342",
        location: "Palo Alto, CA",
        contentHash: "9".repeat(32),
      }),
    ],
  })

  assert.match(captured[0].text, /SELECT\s+external_id,\s*description,/i)
  const upsert = captured[1]
  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  const row = payload[0]
  assert.equal(row.description, existingDescription)
  assert.notEqual(row.content_hash, "9".repeat(32), "fallback description should force a repair write")
  assert.deepEqual((row.raw_data as { raw: { description: string | null } }).raw.description, existingDescription)
  const skills = row.skills as string[]
  assert.ok(skills.includes("CI/CD"))
  assert.ok(skills.includes("GitHub Actions"))
  assert.ok(skills.includes("LLMs"))
  assert.ok(skills.includes("RAG"))
  assert.ok(skills.includes("Code Review"))
})

test("persistJobsBulk: sanitizes malformed unicode/control chars before jsonb payload", async () => {
  const { pool, captured } = makeFakePool([[], [], []])

  await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000006",
    companyMeta: { name: "Acme", domain: null, careersUrl: null },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-11T00:00:00.000Z"),
    jobs: [
      makeJob({
        externalId: "greenhouse:sanitize-1",
        title: "Bad\u0000Title",
        description:
          "Role with malformed surrogate \uD800 and control byte \u0001 in text for robust payload handling.",
        contentHash: "7".repeat(32),
      }),
    ],
  })

  const upsert = captured[0]
  const payload = JSON.parse(upsert.values[4] as string) as Array<Record<string, unknown>>
  assert.equal(payload.length, 1)

  const title = String(payload[0].title ?? "")
  const description = String(payload[0].description ?? "")
  assert.equal(title.includes("\u0000"), false)
  assert.equal(description.includes("\u0001"), false)
  assert.equal(/[\uD800-\uDFFF]/u.test(description), false)
})

test("persistJobsBulk: deactivates stale jobs from the same ATS lane", async () => {
  const { pool, captured } = makeFakePool([
    [],
    [
      {
        id: "11111111-1111-1111-1111-111111111111",
        external_id: "greenhouse:stale",
        last_seen_at: "2026-05-05T00:00:00.000Z",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        external_id: "greenhouse:1",
        last_seen_at: "2026-05-10T00:00:00.000Z",
      },
    ],
    [],
    [],
  ])

  await persistJobsBulk({
    pool,
    companyId: "00000000-0000-0000-0000-000000000007",
    companyMeta: { name: "Acme", domain: "acme.com", careersUrl: null },
    sourceAts: "greenhouse",
    sourceAtsSlug: "acme",
    crawledAt: new Date("2026-05-20T00:00:00.000Z"),
    jobs: [makeJob({ externalId: "greenhouse:1", contentHash: "8".repeat(32) })],
  })

  assert.equal(captured.length, 4, "expected upsert + stale-scan + deactivate + company-update")
  const deactivate = captured[2]
  assert.match(deactivate.text, /UPDATE jobs/)
  assert.match(deactivate.text, /SET is_active = false/)
  const staleIds = deactivate.values[1] as string[]
  assert.deepEqual(staleIds, ["11111111-1111-1111-1111-111111111111"])
})
