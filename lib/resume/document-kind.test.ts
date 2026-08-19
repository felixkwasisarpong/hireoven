import { strict as assert } from "node:assert"
import { test } from "node:test"
import { countPublications, detectDocumentKind, profileFor, type KindResume } from "./document-kind"
import type { Education, ResumeAdditionalSection } from "@/types"

function edu(degree: string): Education {
  return { institution: "Uni", degree, field: "CS", start_date: "2016", end_date: "2020", gpa: null }
}

function section(heading: string, items: string[]): ResumeAdditionalSection {
  return { heading, items }
}

function doc(over: Partial<KindResume> = {}): KindResume {
  return {
    additional_sections: null,
    education: [edu("B.S.")],
    raw_text: "Backend engineer. Java, Spring Boot, Kafka. Built payment systems.",
    summary: "Backend engineer.",
    primary_role: "Backend Engineer",
    ...over,
  }
}

// ── Resumes stay resumes ─────────────────────────────────────────────────────

test("an ordinary industry resume is not promoted to a CV", () => {
  const out = detectDocumentKind(doc())
  assert.equal(out.kind, "resume")
  assert.deepEqual(out.signals, [], "no academic reasons to show")
})

test("a resume that merely mentions one paper stays a resume", () => {
  const out = detectDocumentKind(
    doc({
      additional_sections: [section("Publications", ["Sarpong, F. Adversarial Attacks. SACMAT 2026."])],
      raw_text: "Backend engineer. One paper published at SACMAT.",
    }),
  )
  assert.equal(out.kind, "resume", "a single publications section is not a CV")
})

test("awards and memberships alone do not make a CV", () => {
  const out = detectDocumentKind(
    doc({
      additional_sections: [section("Awards", ["Employee of the year"]), section("Memberships", ["ACM"])],
    }),
  )
  assert.equal(out.kind, "resume")
})

// ── Academic CVs are recognised ──────────────────────────────────────────────

test("a researcher CV is recognised and its reasons are reported", () => {
  const out = detectDocumentKind(
    doc({
      education: [edu("Ph.D."), edu("M.S.")],
      additional_sections: [
        section("Publications", Array.from({ length: 22 }, (_, i) => `Paper ${i + 1}. Journal. DOI: 10.1145/x`)),
        section("Grants and Funding", ["NSF Grant 1234567, Principal Investigator, $450,000"]),
        section("Teaching Experience", ["CS 101, Instructor of Record"]),
        section("Invited Talks", ["Keynote, ACM Symposium"]),
      ],
      raw_text:
        "Postdoctoral researcher. DOI: 10.1145/3750555. Smith et al., Proceedings of the 31st Symposium. Dissertation on privacy.",
    }),
  )
  assert.equal(out.kind, "academic_cv")
  assert.ok(out.confidence > 0.8)
  assert.equal(out.publicationCount, 22)
  assert.ok(out.signals.length > 0)
  assert.ok(out.signals.some((s) => s.toLowerCase().includes("publication")))
})

test("a PhD alone is not enough — plenty of PhDs write industry resumes", () => {
  const out = detectDocumentKind(doc({ education: [edu("Ph.D. ")] }))
  assert.equal(out.kind, "resume")
})

test("grant leadership plus teaching plus publications tips the balance", () => {
  const out = detectDocumentKind(
    doc({
      additional_sections: [
        section("Peer-Reviewed Publications", ["A", "B", "C", "D"]),
        section("Teaching Experience", ["CS 101"]),
      ],
      raw_text: "Principal Investigator on NSF grant. Preprint on arXiv.",
    }),
  )
  assert.equal(out.kind, "academic_cv")
})

// ── Publication counting ─────────────────────────────────────────────────────

test("publications are counted across publication-shaped sections only", () => {
  const r = doc({
    additional_sections: [
      section("Publications", ["A", "B"]),
      section("Conference Proceedings", ["C"]),
      section("Patents", ["D"]),
      section("Volunteer Work", ["Not a paper", "Also not a paper"]),
    ],
  })
  assert.equal(countPublications(r), 4)
})

test("a document with no sections counts zero publications without throwing", () => {
  assert.equal(countPublications(doc({ additional_sections: null })), 0)
})

// ── Profiles ─────────────────────────────────────────────────────────────────

test("the academic profile suspends the conventions that do not apply to a CV", () => {
  const p = profileFor("academic_cv")
  assert.equal(p.checkBulletDensity, false, "CV entries are citations, not scannable bullets")
  assert.equal(p.checkQuantification, false, "publications do not carry KPIs")
  assert.equal(p.checkSummary, false)
  assert.ok(p.longWords >= 4000, "a long CV is correct, not a defect")
})

test("the resume profile keeps every convention in force", () => {
  const p = profileFor("resume")
  assert.equal(p.checkBulletDensity, true)
  assert.equal(p.checkQuantification, true)
  assert.equal(p.checkSummary, true)
  assert.equal(p.longWords, 900)
})
