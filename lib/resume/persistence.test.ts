import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

/**
 * Guards the extract-then-drop class of bug.
 *
 * The parser is explicitly instructed to copy every non-standard section
 * (Publications, Grants, Teaching, Patents, Awards…) into `additional_sections`.
 * Both ingestion routes then wrote every other parsed field to the database and
 * silently omitted that one — so a researcher's entire publication record was
 * extracted, held in memory, and thrown away on every single upload. Nothing
 * errored and nothing logged; the data was simply gone.
 *
 * These read the route source directly, because the bug is not expressible as a
 * unit test of any function: every function involved was behaving correctly.
 */

const ROUTES = [
  { path: "app/api/resume/upload/route.ts", label: "file upload" },
  { path: "app/api/resume/import-linkedin/route.ts", label: "LinkedIn import" },
]

/** Fields the parser fills that must survive the trip to the database. */
const MUST_PERSIST = [
  "work_experience",
  "education",
  "skills",
  "projects",
  "summary",
  "raw_text",
  "additional_sections",
]

for (const route of ROUTES) {
  test(`${route.label} persists every parsed field, including additional_sections`, () => {
    const src = readFileSync(route.path, "utf8")
    for (const column of MUST_PERSIST) {
      assert.ok(
        src.includes(column),
        `${route.path} never mentions "${column}" — parsed content would be dropped`,
      )
    }
    // The column must appear in the write itself, not only in a type or comment.
    assert.ok(
      /additional_sections\s*=\s*\$\d+/.test(src) || /additional_sections\b[\s\S]{0,400}?VALUES/.test(src),
      `${route.path} does not write additional_sections in its INSERT/UPDATE`,
    )
    assert.ok(
      src.includes("parsed.additional_sections"),
      `${route.path} does not pass the parsed additional_sections through as a parameter`,
    )
  })

  test(`${route.label} declares the additional_sections column before writing it`, () => {
    const src = readFileSync(route.path, "utf8")
    assert.ok(
      src.includes("ADD COLUMN IF NOT EXISTS additional_sections"),
      `${route.path} writes additional_sections without guaranteeing the column exists`,
    )
  })
}

test("every placeholder in the ingestion writes has a matching argument", () => {
  // A silently mismatched $n is how the original omission would have been
  // reintroduced when someone added the column back in the wrong position.
  for (const route of ROUTES) {
    const src = readFileSync(route.path, "utf8")
    const statements = src.match(/`(?:INSERT INTO resumes|UPDATE resumes)[\s\S]*?`/g) ?? []
    assert.ok(statements.length > 0, `${route.path} has no resume write statement`)
    for (const sql of statements) {
      const nums = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
      if (nums.length === 0) continue
      const max = Math.max(...nums)
      const unique = [...new Set(nums)].sort((a, b) => a - b)
      assert.deepEqual(
        unique,
        Array.from({ length: max }, (_, i) => i + 1),
        `${route.path} has a gap in its placeholder sequence (max $${max})`,
      )
    }
  }
})
