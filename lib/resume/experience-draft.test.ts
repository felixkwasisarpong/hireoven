import test from "node:test"
import assert from "node:assert/strict"
import {
  splitDescriptionAndAchievements,
  splitDescriptionIntoLines,
} from "@/lib/resume/experience-draft"

test("splitDescriptionAndAchievements separates prose lines from bullet-prefixed lines", () => {
  const raw = [
    "Architected and built Sepurux, an AI agent reliability and chaos engineering platform.",
    "Architected Sepurux, currently in active pilot with early adopters.",
    "- Engineered Python API layer with auto-generated TypeScript and Go SDKs",
    "- Built GitHub Actions CI Guardrails for policy validation",
    "- Chaos campaign runs complete in ~30 seconds",
  ].join("\n")

  const { description, achievements } = splitDescriptionAndAchievements(raw)

  assert.equal(
    description,
    "Architected and built Sepurux, an AI agent reliability and chaos engineering platform.\nArchitected Sepurux, currently in active pilot with early adopters."
  )
  assert.deepEqual(achievements, [
    "Engineered Python API layer with auto-generated TypeScript and Go SDKs",
    "Built GitHub Actions CI Guardrails for policy validation",
    "Chaos campaign runs complete in ~30 seconds",
  ])
})

test("splitDescriptionAndAchievements supports the bullet-dot prefix too", () => {
  const raw = "Some intro line.\n• Shipped feature X\n• Shipped feature Y"
  const { description, achievements } = splitDescriptionAndAchievements(raw)
  assert.equal(description, "Some intro line.")
  assert.deepEqual(achievements, ["Shipped feature X", "Shipped feature Y"])
})

test("splitDescriptionAndAchievements handles an all-prose entry with no bullets", () => {
  const raw = "Built and maintained backend services.\nDelivered REST APIs and data pipelines."
  const { description, achievements } = splitDescriptionAndAchievements(raw)
  assert.equal(description, raw)
  assert.deepEqual(achievements, [])
})

test("splitDescriptionAndAchievements handles an all-bullets entry with no prose", () => {
  const raw = "- Built REST APIs\n- Shipped the mobile app"
  const { description, achievements } = splitDescriptionAndAchievements(raw)
  assert.equal(description, "")
  assert.deepEqual(achievements, ["Built REST APIs", "Shipped the mobile app"])
})

test("splitDescriptionIntoLines returns one entry per non-empty line, trimmed", () => {
  const lines = splitDescriptionIntoLines(
    "  Architected and built Sepurux, an AI agent reliability platform.  \n\nArchitected Sepurux, currently in active pilot.\n"
  )
  assert.deepEqual(lines, [
    "Architected and built Sepurux, an AI agent reliability platform.",
    "Architected Sepurux, currently in active pilot.",
  ])
})
