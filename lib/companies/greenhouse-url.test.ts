import test from "node:test"
import assert from "node:assert/strict"
import {
  extractGreenhouseBoardToken,
  normalizeGreenhouseBoardUrl,
} from "@/lib/companies/greenhouse-url"

test("extractGreenhouseBoardToken reads board from api.greenhouse.io path", () => {
  const token = extractGreenhouseBoardToken(
    "https://api.greenhouse.io/v1/boards/lyft/jobs?content=true"
  )
  assert.equal(token, "lyft")
})

test("extractGreenhouseBoardToken does not infer api as board token", () => {
  const token = extractGreenhouseBoardToken("https://api.greenhouse.io/v1/status")
  assert.equal(token, null)
})

test("normalizeGreenhouseBoardUrl normalizes api endpoint to stable board URL", () => {
  const normalized = normalizeGreenhouseBoardUrl(
    "https://api.greenhouse.io/v1/boards/lyft/jobs?content=true"
  )
  assert.equal(normalized.boardToken, "lyft")
  assert.equal(normalized.normalizedUrl, "https://boards.greenhouse.io/lyft")
})
