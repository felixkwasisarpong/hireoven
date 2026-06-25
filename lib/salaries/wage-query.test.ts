import test from "node:test"
import assert from "node:assert/strict"
import { wageLevelNumber } from "@/lib/salaries/soc-roles"
import { MIN_N_FOR_DISPLAY } from "@/lib/salaries/wage-query"

test("wageLevelNumber maps roman levels to 1-4, else null", () => {
  assert.equal(wageLevelNumber("I"), 1)
  assert.equal(wageLevelNumber("II"), 2)
  assert.equal(wageLevelNumber("III"), 3)
  assert.equal(wageLevelNumber("IV"), 4)
  assert.equal(wageLevelNumber("NA"), null)
  assert.equal(wageLevelNumber(null), null)
})

test("display threshold is 5 filings", () => {
  assert.equal(MIN_N_FOR_DISPLAY, 5)
})
