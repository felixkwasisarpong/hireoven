import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildResumeReview, parseMonth, type ReviewResume } from "./review"
import type { PivotSuggestion } from "@/lib/resume/pivot-suggest"
import type { FieldFit, PositioningBrief, ResumeSignal } from "@/lib/resume/signal"
import type { WorkExperience } from "@/types"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function role(over: Partial<WorkExperience> = {}): WorkExperience {
  return {
    company: "Acme",
    title: "Engineer",
    start_date: "2020-01",
    end_date: "2022-01",
    is_current: false,
    description: "",
    achievements: [],
    ...over,
  }
}

function resume(over: Partial<ReviewResume> = {}): ReviewResume {
  return {
    summary:
      "Backend engineer with six years building production payment systems. Owned a card platform at over 1 million transactions per day at roughly 140ms p95. Seeking a full-time backend role.",
    raw_text: "Backend engineer. Authorized to work in the US on F-1 OPT. Java, Spring Boot, Kafka.",
    work_experience: [role()],
    top_skills: ["java"],
    skills: null,
    primary_role: "Backend Engineer",
    target_field: "backend",
    email: "felix@example.com",
    phone: "+1 555 0100",
    linkedin_url: "https://linkedin.com/in/x",
    additional_sections: null,
    education: null,
    ...over,
  }
}

function fit(key: string, label: string, score: number): FieldFit {
  return { key, label, score, matched: [], missing: [] }
}

function signal(fields: FieldFit[], split = false): ResumeSignal {
  const sorted = [...fields].sort((a, b) => b.score - a.score)
  return { fields: sorted, primary: sorted[0] ?? null, runnerUp: sorted[1] ?? null, split }
}

function ids(input: Parameters<typeof buildResumeReview>[0]): string[] {
  return buildResumeReview(input).findings.map((f) => f.id)
}

// ── parseMonth ───────────────────────────────────────────────────────────────

test("parseMonth accepts the date formats resumes actually carry", () => {
  assert.equal(parseMonth("2026-03"), 2026 * 12 + 2)
  assert.equal(parseMonth("2026-03-15"), 2026 * 12 + 2)
  assert.equal(parseMonth("03/2026"), 2026 * 12 + 2)
  assert.equal(parseMonth("March 2026"), 2026 * 12 + 2)
  assert.equal(parseMonth("Mar 2026"), 2026 * 12 + 2)
  assert.equal(parseMonth("2026"), 2026 * 12)
  assert.equal(parseMonth("Present"), null)
  assert.equal(parseMonth(null), null)
  assert.equal(parseMonth("whenever"), null)
})

// ── Authorization silence ────────────────────────────────────────────────────

test("silence on work authorization is flagged as a blocker", () => {
  const review = buildResumeReview({ resume: resume({ raw_text: "Backend engineer. Java, Kafka." }) })
  const finding = review.findings.find((f) => f.id === "authorization_silent")
  assert.ok(finding, "expected authorization_silent")
  assert.equal(finding.severity, "blocker")
})

test("any explicit status statement clears the authorization finding", () => {
  for (const statement of [
    "Authorized to work in the US on F-1 OPT",
    "US Citizen",
    "Green card holder",
    "Will require H-1B sponsorship",
    "Permanent resident",
  ]) {
    const review = buildResumeReview({ resume: resume({ raw_text: `Engineer. ${statement}.` }) })
    assert.ok(
      !review.findings.some((f) => f.id === "authorization_silent"),
      `expected no finding for: ${statement}`,
    )
  }
})

// ── Split signal ─────────────────────────────────────────────────────────────

test("a split signal reports both fields with their scores as evidence", () => {
  const review = buildResumeReview({
    resume: resume(),
    signal: signal([fit("fintech", "Fintech", 48), fit("ai_ml", "AI / ML", 44)], true),
  })
  const finding = review.findings.find((f) => f.id === "split_signal")
  assert.ok(finding)
  assert.equal(finding.severity, "blocker")
  assert.ok(finding.evidence.some((e) => e.includes("Fintech") && e.includes("48")))
  assert.ok(finding.evidence.some((e) => e.includes("AI / ML") && e.includes("44")))
})

test("a clear single-lane signal produces no split finding", () => {
  const review = buildResumeReview({
    resume: resume(),
    signal: signal([fit("backend", "Backend", 61), fit("data", "Data", 18)], false),
  })
  assert.ok(!review.findings.some((f) => f.id === "split_signal"))
})

// ── Targeting / sponsorship ──────────────────────────────────────────────────

function pivot(over: Partial<PivotSuggestion> = {}): PivotSuggestion {
  return {
    fromKey: "fintech",
    fromLabel: "Fintech",
    toKey: "ai_ml",
    toLabel: "AI / ML",
    currentFit: 38,
    currentJobCount: 10_000,
    targetJobCount: 20_000,
    jobMultiple: 2,
    currentSponsorship: 0.35,
    targetSponsorship: 0.62,
    sponsorDelta: 27,
    bridgeSkills: ["pytorch"],
    driver: "sponsorship",
    ...over,
  }
}

test("a materially higher-sponsorship pivot becomes a targeting blocker", () => {
  const review = buildResumeReview({ resume: resume(), pivot: pivot() })
  const finding = review.findings.find((f) => f.id === "targeting_sponsorship")
  assert.ok(finding)
  assert.equal(finding.severity, "blocker")
  assert.ok(finding.evidence.some((e) => e.includes("35%")))
  assert.ok(finding.evidence.some((e) => e.includes("62%")))
})

test("a pivot without a real sponsorship edge is not raised as a targeting problem", () => {
  const review = buildResumeReview({
    resume: resume(),
    pivot: pivot({ currentSponsorship: 0.5, targetSponsorship: 0.54, sponsorDelta: 4, driver: "demand" }),
  })
  assert.ok(!review.findings.some((f) => f.id === "targeting_sponsorship"))
})

test("a pivot with unknown sponsorship density is never guessed at", () => {
  const review = buildResumeReview({
    resume: resume(),
    pivot: pivot({ currentSponsorship: undefined, targetSponsorship: undefined, sponsorDelta: 30 }),
  })
  assert.ok(!review.findings.some((f) => f.id === "targeting_sponsorship"))
})

// ── Concurrent current roles ─────────────────────────────────────────────────

test("two concurrent current roles are flagged and both are named", () => {
  const review = buildResumeReview({
    resume: resume({
      work_experience: [
        role({ title: "Founder", company: "HireOven", is_current: true, end_date: null }),
        role({ title: "GenAI Engineer", company: "Dreamline", is_current: true, end_date: null }),
      ],
    }),
  })
  const finding = review.findings.find((f) => f.id === "concurrent_current_roles")
  assert.ok(finding)
  assert.ok(finding.evidence.includes("Founder, HireOven"))
  assert.ok(finding.evidence.includes("GenAI Engineer, Dreamline"))
})

test("a single current role is normal and produces nothing", () => {
  const review = buildResumeReview({
    resume: resume({ work_experience: [role({ is_current: true, end_date: null })] }),
  })
  assert.ok(!review.findings.some((f) => f.id === "concurrent_current_roles"))
})

// ── Employment gap ───────────────────────────────────────────────────────────

test("a gap between two roles is measured in months and both sides are named", () => {
  const review = buildResumeReview({
    resume: resume({
      work_experience: [
        role({ title: "Engineer", company: "Old", start_date: "2019-01", end_date: "2020-01" }),
        role({ title: "Engineer", company: "New", start_date: "2021-06", end_date: "2022-01" }),
      ],
    }),
  })
  const finding = review.findings.find((f) => f.id === "employment_gap")
  assert.ok(finding)
  assert.ok(finding.title.includes("17"))
  assert.ok(finding.evidence[0].includes("Engineer, Old"))
})

test("a trailing gap is only computed when asOf is supplied", () => {
  const past = resume({
    work_experience: [role({ start_date: "2019-01", end_date: "2020-01", is_current: false })],
  })
  assert.ok(!ids({ resume: past }).includes("employment_gap"), "no clock, no trailing-gap claim")

  const withClock = buildResumeReview({
    resume: resume({
      work_experience: [
        role({ title: "A", start_date: "2018-01", end_date: "2019-01" }),
        role({ title: "B", start_date: "2019-02", end_date: "2020-01" }),
      ],
    }),
    asOf: "2022-01",
  })
  const finding = withClock.findings.find((f) => f.id === "employment_gap")
  assert.ok(finding)
  assert.ok(finding.evidence[0].includes("today"))
})

test("a current role means there is no trailing gap", () => {
  const review = buildResumeReview({
    resume: resume({ work_experience: [role({ start_date: "2019-01", end_date: null, is_current: true })] }),
    asOf: "2026-08",
  })
  assert.ok(!review.findings.some((f) => f.id === "employment_gap"))
})

// ── Document-level checks ────────────────────────────────────────────────────

test("length is reported in words and estimated pages", () => {
  const review = buildResumeReview({ resume: resume({ raw_text: `${"word ".repeat(2300)} OPT` }) })
  const finding = review.findings.find((f) => f.id === "too_long")
  assert.ok(finding)
  assert.ok(finding.evidence.some((e) => e.includes("2,301")))
})

test("dense bullets are quoted back with their word counts", () => {
  const long = `${"clause ".repeat(60)}`
  const review = buildResumeReview({
    resume: resume({ work_experience: [role({ achievements: [long, long, "Short one"] })] }),
  })
  const finding = review.findings.find((f) => f.id === "dense_bullets")
  assert.ok(finding)
  assert.ok(finding.title.includes("2"))
  assert.ok(finding.evidence[0].includes("60 words"))
})

test("quantification is scored as a share of all bullets", () => {
  const review = buildResumeReview({
    resume: resume({
      work_experience: [
        role({ achievements: ["Improved things", "Built stuff", "Led work", "Shipped features"] }),
      ],
    }),
  })
  const finding = review.findings.find((f) => f.id === "unquantified")
  assert.ok(finding)
  assert.ok(finding.observation.includes("0 of 4"))
})

test("well-quantified bullets pass", () => {
  const review = buildResumeReview({
    resume: resume({
      work_experience: [
        role({
          achievements: [
            "Cut latency 25%",
            "Owned 1M transactions per day",
            "Reduced MTTR 35%",
            "Mentored 5 interns",
          ],
        }),
      ],
    }),
  })
  assert.ok(!review.findings.some((f) => f.id === "unquantified"))
})

test("filler phrasing in the summary is named back to the user", () => {
  const review = buildResumeReview({
    resume: resume({
      summary:
        "A hard-working team player and results-driven engineer with a proven track record of delivering value across many different organisations and teams.",
    }),
  })
  const finding = review.findings.find((f) => f.id === "weak_summary")
  assert.ok(finding)
  assert.ok(finding.observation.includes("hard-working"))
})

test("a missing email outranks a missing LinkedIn", () => {
  const noEmail = buildResumeReview({ resume: resume({ email: null }) }).findings.find(
    (f) => f.id === "contact_incomplete",
  )
  const noLinked = buildResumeReview({ resume: resume({ linkedin_url: null }) }).findings.find(
    (f) => f.id === "contact_incomplete",
  )
  assert.ok(noEmail && noLinked)
  assert.equal(noEmail.severity, "major")
  assert.equal(noLinked.severity, "minor")
  assert.ok(noEmail.weight > noLinked.weight)
})

// ── Ranking and verdict ──────────────────────────────────────────────────────

test("structural findings always outrank cosmetic ones", () => {
  const review = buildResumeReview({
    resume: resume({
      raw_text: "Engineer. Java.", // no authorization statement
      summary: "Short.",
      work_experience: [role({ achievements: ["Did a thing", "Did another", "And another", "One more"] })],
    }),
    signal: signal([fit("fintech", "Fintech", 48), fit("ai_ml", "AI / ML", 45)], true),
  })
  const order = review.findings.map((f) => f.id)
  assert.ok(
    order.indexOf("authorization_silent") < order.indexOf("unquantified"),
    "authorization must come before bullet quantification",
  )
  assert.ok(
    order.indexOf("split_signal") < order.indexOf("weak_summary"),
    "positioning must come before summary polish",
  )
  assert.ok(review.blockers >= 2)
})

test("the verdict leads with the single most expensive finding", () => {
  const review = buildResumeReview({ resume: resume({ raw_text: "Engineer. Java." }) })
  assert.ok(review.verdict.includes("can end an application"))
  assert.ok(review.verdict.toLowerCase().includes("work authorization"))
})

test("a clean resume gets an honest all-clear that points at targeting", () => {
  const review = buildResumeReview({
    resume: resume({
      work_experience: [
        role({
          is_current: true,
          end_date: null,
          achievements: ["Cut latency 25%", "Owned 1M transactions/day", "Reduced MTTR 35%", "Mentored 5 interns"],
        }),
      ],
    }),
    signal: signal([fit("backend", "Backend Engineering", 62), fit("data", "Data", 20)], false),
  })
  assert.equal(review.findings.length, 0)
  assert.ok(review.verdict.includes("where you are sending it"))
  assert.equal(review.readsAs, "Backend Engineering")
})

test("every finding carries evidence and a fix, so nothing is an unactionable scold", () => {
  const review = buildResumeReview({
    resume: resume({
      raw_text: `${"word ".repeat(1000)}`,
      summary: null,
      email: null,
      work_experience: [
        role({ title: "A", company: "X", is_current: true, end_date: null }),
        role({ title: "B", company: "Y", is_current: true, end_date: null }),
      ],
    }),
    signal: signal([fit("fintech", "Fintech", 48), fit("ai_ml", "AI / ML", 46)], true),
    pivot: pivot(),
    brief: {
      targetKey: "ai_ml",
      targetLabel: "AI / ML",
      score: 40,
      leadWith: ["python"],
      surface: ["pytorch", "rag"],
      closeGaps: ["mlops"],
    } satisfies PositioningBrief,
  })
  assert.ok(review.findings.length >= 6)
  for (const f of review.findings) {
    assert.ok(f.evidence.length > 0, `${f.id} has no evidence`)
    assert.ok(f.fix.length > 20, `${f.id} has no usable fix`)
    assert.ok(f.action?.href.startsWith("/dashboard/"), `${f.id} has no deep link`)
  }
})

// ── Document kind changes the rulebook ───────────────────────────────────────

const ACADEMIC = {
  kind: "academic_cv" as const,
  confidence: 0.9,
  signals: ["3 academic sections: publications, grants, teaching experience"],
  publicationCount: 22,
}

function longProseRole() {
  // Citation-style entries: long, no metrics. Normal on a CV, a finding on a resume.
  const citation = `${"Sarpong F and Liao S Adversarial attacks on private factorization machines in recommender systems ".repeat(4)}`
  return role({ achievements: [citation, citation, citation, citation] })
}

test("an academic CV is not told it is too long", () => {
  const cv = resume({ raw_text: `${"word ".repeat(3000)} OPT` })
  assert.ok(ids({ resume: cv }).includes("too_long"), "a 3,000-word resume is too long")
  assert.ok(
    !ids({ resume: cv, kind: ACADEMIC }).includes("too_long"),
    "a 3,000-word CV is normal and must not be flagged",
  )
})

test("a CV long even by CV standards is still flagged", () => {
  const huge = resume({ raw_text: `${"word ".repeat(6000)} OPT` })
  assert.ok(ids({ resume: huge, kind: ACADEMIC }).includes("too_long"))
})

test("citation-length entries and missing metrics are not defects on a CV", () => {
  const cv = resume({ work_experience: [longProseRole()] })
  const asResume = ids({ resume: cv })
  assert.ok(asResume.includes("dense_bullets"))
  assert.ok(asResume.includes("unquantified"))

  const asCv = ids({ resume: cv, kind: ACADEMIC })
  assert.ok(!asCv.includes("dense_bullets"), "publications are citations, not scannable bullets")
  assert.ok(!asCv.includes("unquantified"), "papers do not carry KPIs")
})

test("summary conventions are suspended for a CV", () => {
  const cv = resume({ summary: null })
  assert.ok(ids({ resume: cv }).includes("weak_summary"))
  assert.ok(!ids({ resume: cv, kind: ACADEMIC }).includes("weak_summary"))
})

test("a CV is told plainly that it is the wrong document for industry", () => {
  const out = buildResumeReview({
    resume: resume(),
    kind: ACADEMIC,
    signal: signal([fit("ai_ml", "AI / Machine Learning", 55)], false),
  })
  const finding = out.findings.find((f) => f.id === "academic_cv_for_industry")
  assert.ok(finding)
  assert.equal(finding.severity, "major")
  assert.ok(finding.evidence.some((e) => e.includes("academic sections")))
  // It must not tell a researcher their CV is simply wrong.
  assert.ok(finding.fix.includes("Keep this CV"))
})

test("structural findings still outrank the format finding on a CV", () => {
  const out = buildResumeReview({
    resume: resume({ raw_text: "Researcher. Publications." }), // no authorization line
    kind: ACADEMIC,
  })
  const order = out.findings.map((f) => f.id)
  assert.ok(order.indexOf("authorization_silent") < order.indexOf("academic_cv_for_industry"))
})

test("an ordinary resume never gets the academic-format finding", () => {
  assert.ok(!ids({ resume: resume() }).includes("academic_cv_for_industry"))
  assert.ok(
    !ids({ resume: resume(), kind: { kind: "resume", confidence: 0.1, signals: [], publicationCount: 0 } }).includes(
      "academic_cv_for_industry",
    ),
  )
})

test("the review reports which rulebook it used", () => {
  assert.equal(buildResumeReview({ resume: resume() }).documentKindLabel, "Resume")
  const cv = buildResumeReview({ resume: resume(), kind: ACADEMIC })
  assert.equal(cv.documentKind, "academic_cv")
  assert.equal(cv.documentKindLabel, "Academic CV")
  assert.deepEqual(cv.documentKindSignals, ACADEMIC.signals)
})
