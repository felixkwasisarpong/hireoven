import { strict as assert } from "node:assert"
import { test } from "node:test"
import { deriveAboutRoleParagraphs } from "./view-model"

test("deriveAboutRoleParagraphs: keeps extracted paragraphs when present", () => {
  const extracted = ["Build platform services.", "Partner with product and design."]
  const result = deriveAboutRoleParagraphs(extracted, null)
  assert.deepEqual(result, extracted)
})

test("deriveAboutRoleParagraphs: falls back to single-line ATS content with section headings", () => {
  const description = [
    "RESPONSIBILITIES:",
    "Own and evolve backend APIs across enterprise systems while collaborating with analytics, product, and security teams to deliver reliable platform capabilities at scale",
    "QUALIFICATIONS:",
    "5+ years building production services with strong ownership and communication skills",
  ].join("\n")

  const result = deriveAboutRoleParagraphs([], description)

  assert.ok(result.length > 0)
  assert.ok(result[0].includes("Own and evolve backend APIs"))
  assert.ok(!/^RESPONSIBILITIES[:\s-]*$/i.test(result[0]))
})
