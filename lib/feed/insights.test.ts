import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildFeedInsights } from "./insights"
import type { FieldProfile } from "@/lib/resume/signal"

// A résumé blob strong in backend/devops terms; jsonb skills shape.
const resume = {
  primary_role: "Backend Engineer",
  top_skills: ["python", "aws", "postgres"],
  skills: { technical: ["python", "aws", "postgres", "kubernetes", "terraform"], soft: [], languages: [], certifications: [] },
  work_experience: [{ title: "Backend Engineer", description: "microservices, distributed systems, api, go", achievements: [] }],
  industries: [],
  summary: "backend and devops",
  raw_text: "backend microservices kubernetes terraform aws",
} as any

function profile(key: string, label: string, jobCount: number, share: number, skills: string[]): FieldProfile {
  return { key, label, jobCount, sponsorshipShare: share, skills: skills.map((s, i) => ({ skill: s, share: 0.5 - i * 0.01 })) }
}

test("returns [] without a corpus", () => {
  assert.deepEqual(buildFeedInsights(resume, []), [])
  assert.deepEqual(buildFeedInsights(null, []), [])
})

test("builds grounded cards and orders them by priority", () => {
  const profiles = [
    profile("devops", "DevOps", 22000, 0.55, ["kubernetes", "terraform", "aws", "docker", "ci/cd", "prometheus", "helm", "ansible"]),
    profile("backend", "Backend", 32000, 0.47, ["python", "go", "postgres", "kafka", "grpc", "redis", "microservices", "rest"]),
  ]
  const cards = buildFeedInsights(resume, profiles)
  assert.ok(cards.length > 0, "expected at least one card")
  // priority order is non-increasing
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i - 1].priority >= cards[i].priority)
  // ids are unique + stable-shaped
  const ids = new Set(cards.map((c) => c.id))
  assert.equal(ids.size, cards.length)
})

test("skill_boost never contains soft-skill boilerplate", () => {
  const profiles = [
    profile("backend", "Backend", 32000, 0.47, ["communication", "leadership", "kafka", "grpc", "redis", "graphql", "rust", "scala"]),
  ]
  const cards = buildFeedInsights(resume, profiles)
  const boost = cards.find((c) => c.type === "skill_boost")
  if (boost && boost.type === "skill_boost") {
    for (const s of boost.skills) assert.ok(!["communication", "leadership"].includes(s.toLowerCase()))
  }
})
