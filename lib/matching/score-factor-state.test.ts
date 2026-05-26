import { strict as assert } from "node:assert"
import { test } from "node:test"
import { resolveSkillsFactorValue } from "./score-factor-state"

test("resolveSkillsFactorValue: marks missing required-skills context as not computed", () => {
  const result = resolveSkillsFactorValue({
    fastScore: {
      skills_score: 0,
      total_required_skills: 0,
      score_breakdown: null,
    },
  })

  assert.equal(result.state, "not_computed")
  assert.equal(result.value, null)
  assert.equal(result.reason, "no_required_skills")
})

test("resolveSkillsFactorValue: keeps true zero when required skills exist", () => {
  const result = resolveSkillsFactorValue({
    fastScore: {
      skills_score: 0,
      total_required_skills: 6,
      score_breakdown: null,
    },
  })

  assert.equal(result.state, "computed")
  assert.equal(result.value, 0)
})

test("resolveSkillsFactorValue: deep-analysis zero without evidence is not computed", () => {
  const result = resolveSkillsFactorValue({
    analysis: {
      skills_score: 0,
      matching_skills: [],
      missing_skills: [],
      bonus_skills: [],
    },
    fastScore: {
      skills_score: 35,
      total_required_skills: 0,
      score_breakdown: null,
    },
  })

  assert.equal(result.state, "not_computed")
  assert.equal(result.value, null)
  assert.equal(result.reason, "no_skill_evidence")
})

test("resolveSkillsFactorValue: deep-analysis zero with evidence remains computed", () => {
  const result = resolveSkillsFactorValue({
    analysis: {
      skills_score: 0,
      matching_skills: [],
      missing_skills: ["React", "TypeScript"],
      bonus_skills: [],
    },
    fastScore: {
      skills_score: 25,
      total_required_skills: 5,
      score_breakdown: null,
    },
  })

  assert.equal(result.state, "computed")
  assert.equal(result.value, 0)
})
