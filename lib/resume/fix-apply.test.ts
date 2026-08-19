import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  applyProposedEdit,
  applyProposedEdits,
  proposeAuthorizationLine,
  proposeContactDetails,
  proposeSingleCurrentRole,
  proposeSurfacedSkills,
  proposeTargetField,
} from "./fix-apply"
import type { Resume, WorkExperience } from "@/types"

function role(over: Partial<WorkExperience> = {}): WorkExperience {
  return {
    company: "Acme",
    title: "Engineer",
    start_date: "2020-01",
    end_date: null,
    is_current: false,
    description: "",
    achievements: [],
    ...over,
  }
}

function resume(over: Partial<Resume> = {}): Resume {
  return {
    id: "r1",
    user_id: "u1",
    file_name: "cv.pdf",
    name: "CV",
    file_url: "",
    storage_path: "",
    file_size: null,
    is_primary: true,
    parse_status: "complete",
    full_name: "Felix",
    email: "felix@example.com",
    phone: "+1 555 0100",
    location: "Houston",
    linkedin_url: "https://linkedin.com/in/felix",
    portfolio_url: null,
    summary: "Backend engineer.",
    work_experience: [role()],
    education: [],
    skills: { technical: ["java"], soft: [], languages: [], certifications: [] },
    projects: [],
    seniority_level: null,
    years_of_experience: 6,
    primary_role: "Backend Engineer",
    industries: [],
    top_skills: ["java"],
    resume_score: null,
    raw_text: "…",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  } as Resume
}

// ── Surfacing buried skills ──────────────────────────────────────────────────

test("buried skills are appended without disturbing the ones already listed", () => {
  const edit = proposeSurfacedSkills(resume(), ["kafka", "redis"])
  assert.ok(edit)
  assert.equal(edit.target, "skills")
  assert.deepEqual((edit.content as { technical: string[] }).technical, ["java", "kafka", "redis"])
  assert.ok(edit.before.includes("java"))
  assert.ok(edit.after.includes("kafka"))
})

test("a skill already listed is not duplicated, case-insensitively", () => {
  assert.equal(proposeSurfacedSkills(resume(), ["Java"]), null)
  const edit = proposeSurfacedSkills(resume(), ["Java", "Kafka"])
  assert.deepEqual((edit?.content as { technical: string[] }).technical, ["java", "Kafka"])
})

test("nothing to surface proposes nothing", () => {
  assert.equal(proposeSurfacedSkills(resume(), []), null)
  assert.equal(proposeSurfacedSkills(resume(), ["  "]), null)
})

// ── One current role ─────────────────────────────────────────────────────────

const twoCurrent = () =>
  resume({
    work_experience: [
      role({ title: "Founder", company: "HireOven", is_current: true }),
      role({ title: "GenAI Engineer", company: "Dreamline", is_current: true }),
      role({ title: "Engineer", company: "EFT", is_current: false }),
    ],
  })

test("only the chosen role stays current", () => {
  const edit = proposeSingleCurrentRole(twoCurrent(), "GenAI Engineer, Dreamline")
  assert.ok(edit)
  const next = edit.content as WorkExperience[]
  assert.deepEqual(
    next.map((r) => [r.title, r.is_current]),
    [
      ["Founder", false],
      ["GenAI Engineer", true],
      ["Engineer", false],
    ],
  )
})

test("no end date is invented for the role that was closed", () => {
  const edit = proposeSingleCurrentRole(twoCurrent(), "GenAI Engineer, Dreamline")
  const closed = (edit?.content as WorkExperience[])[0]
  assert.equal(closed.is_current, false)
  assert.equal(closed.end_date, null, "a guessed end date would be worse than none")
})

test("an answer naming a role that does not exist is refused", () => {
  assert.equal(proposeSingleCurrentRole(twoCurrent(), "CEO, Nowhere"), null)
})

test("a resume with one current role needs no change", () => {
  assert.equal(proposeSingleCurrentRole(resume(), "Engineer, Acme"), null)
})

// ── Work authorization ───────────────────────────────────────────────────────

test("the user's own sentence is appended to the summary verbatim", () => {
  const edit = proposeAuthorizationLine(resume(), "F-1 OPT through March 2027, STEM eligible")
  assert.ok(edit)
  assert.equal(edit.target, "summary")
  assert.equal(edit.content, "Backend engineer. F-1 OPT through March 2027, STEM eligible.")
})

test("existing punctuation is respected rather than doubled", () => {
  const edit = proposeAuthorizationLine(resume(), "US citizen.")
  assert.equal(edit?.content, "Backend engineer. US citizen.")
})

test("a resume with no summary still gets the line", () => {
  const edit = proposeAuthorizationLine(resume({ summary: null }), "Green card holder")
  assert.equal(edit?.content, "Green card holder.")
  assert.equal(edit?.before, "(no summary)")
})

test("an empty answer proposes nothing", () => {
  assert.equal(proposeAuthorizationLine(resume(), "   "), null)
})

// ── Contact details ──────────────────────────────────────────────────────────

test("contact details are pulled out of a free-text answer", () => {
  const edit = proposeContactDetails(
    resume({ email: null, phone: null, linkedin_url: null }),
    "reach me at felix@hireoven.com or +1 555 0199, linkedin.com/in/felix-kwasi-sarpong",
  )
  assert.ok(edit)
  const patch = edit.content as Record<string, string>
  assert.equal(patch.email, "felix@hireoven.com")
  assert.ok(patch.phone?.includes("555"))
  assert.equal(patch.linkedin_url, "https://linkedin.com/in/felix-kwasi-sarpong")
})

test("international and short-form numbers are not silently dropped", () => {
  for (const answer of ["+44 20 7946 0958", "+233 24 123 4567", "(832) 555-0199"]) {
    const edit = proposeContactDetails(resume({ phone: null }), answer)
    const patch = edit?.content as Record<string, string> | undefined
    assert.ok(patch?.phone, `expected a phone from: ${answer}`)
  }
})

test("a LinkedIn URL containing digits is not mistaken for a phone number", () => {
  const edit = proposeContactDetails(
    resume({ phone: null, linkedin_url: null }),
    "linkedin.com/in/felix-1234567890",
  )
  const patch = edit?.content as Record<string, string>
  assert.equal(patch.phone, undefined)
  assert.ok(patch.linkedin_url)
})

test("fields the answer does not mention are left alone, not blanked", () => {
  const edit = proposeContactDetails(resume({ email: null }), "felix@hireoven.com")
  const patch = edit?.content as Record<string, string>
  assert.deepEqual(Object.keys(patch), ["email"])
})

test("an answer that changes nothing proposes nothing", () => {
  assert.equal(proposeContactDetails(resume(), "felix@example.com"), null)
  assert.equal(proposeContactDetails(resume(), "no details here"), null)
})

// ── Target field ─────────────────────────────────────────────────────────────

test("setting the matching lane is a settings change, not a document edit", () => {
  const edit = proposeTargetField(resume({ target_field: null }), "backend", "Backend Engineering")
  assert.ok(edit)
  assert.equal(edit.target, "settings")
  assert.deepEqual(edit.content, { target_field: "backend" })
})

test("an unchanged lane proposes nothing", () => {
  assert.equal(proposeTargetField(resume({ target_field: "backend" }), "backend", "Backend"), null)
})

// ── Applying ─────────────────────────────────────────────────────────────────

test("each proposal applies to its own section and leaves the rest untouched", () => {
  const base = resume({ target_field: null })
  const skills = proposeSurfacedSkills(base, ["kafka"])!
  const auth = proposeAuthorizationLine(base, "F-1 OPT")!
  const lane = proposeTargetField(base, "backend", "Backend")!

  const next = applyProposedEdits(base, [skills, auth, lane])
  assert.deepEqual(next.skills?.technical, ["java", "kafka"])
  assert.equal(next.summary, "Backend engineer. F-1 OPT.")
  assert.equal(next.target_field, "backend")
  assert.equal(next.full_name, base.full_name, "unrelated fields survive")
  assert.equal(base.summary, "Backend engineer.", "the original object is not mutated")
})

test("an unrecognised target is a no-op rather than a half-written resume", () => {
  const base = resume()
  const next = applyProposedEdit(base, {
    findingId: "x",
    target: "education",
    label: "?",
    before: "",
    after: "",
    content: { nonsense: true },
  })
  assert.deepEqual(next, base)
})

test("applying an empty approval set changes nothing", () => {
  const base = resume()
  assert.deepEqual(applyProposedEdits(base, []), base)
})
