import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Job, Profile, Resume } from "@/types"
import { buildFastScoreResumeContext, classifyRoleFamily, computeFastScore } from "./fast-scorer"

test("classifyRoleFamily keeps principal and machine-learning engineering roles in tech", () => {
  assert.equal(classifyRoleFamily("Principal Software Engineer, Site Reliability"), "tech")
  assert.equal(classifyRoleFamily("Machine Learning Engineer"), "tech")
})

test("classifyRoleFamily treats common IT infrastructure titles as tech", () => {
  assert.equal(classifyRoleFamily("IT Specialist Senior"), "tech")
  assert.equal(classifyRoleFamily("Cloud Systems Administrator II"), "tech")
  assert.equal(classifyRoleFamily("Help Desk Specialist I - Tier 1"), "tech")
  assert.equal(classifyRoleFamily("Analyst Learning Admin Help Desk"), "tech")
  assert.equal(classifyRoleFamily("Desktop Support Technician"), "tech")
})

test("classifyRoleFamily does not classify server infrastructure text as foodservice", () => {
  assert.equal(
    classifyRoleFamily(
      "Systems Administrator",
      "Maintain Linux servers, DNS, firewalls, VPN access, and deployment automation."
    ),
    "tech"
  )
})

const baseProfile: Profile = {
  id: "user-1",
  email: null,
  full_name: null,
  avatar_url: null,
  desired_roles: null,
  desired_locations: null,
  desired_seniority: null,
  desired_employment_types: null,
  seniority_level: "senior",
  top_skills: null,
  remote_only: false,
  is_international: false,
  visa_status: null,
  opt_end_date: null,
  needs_sponsorship: false,
  alert_frequency: "daily",
  email_alerts: false,
  push_alerts: false,
  is_admin: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}

function makeHealthcareResume(overrides: Partial<Resume> = {}): Resume {
  return {
    id: "resume-health-1",
    user_id: "user-1",
    file_name: "healthcare.pdf",
    name: "Healthcare Candidate",
    file_url: "",
    storage_path: "",
    file_size: null,
    file_type: "application/pdf",
    is_primary: true,
    parse_status: "complete",
    full_name: "Healthcare Candidate",
    email: null,
    phone: null,
    location: null,
    linkedin_url: null,
    portfolio_url: null,
    github_url: null,
    summary: "Pharmacist and research assistant with patient care and clinical laboratory experience.",
    work_experience: [
      {
        company: "Community Pharmacy",
        title: "Community Pharmacist",
        start_date: "2018",
        end_date: null,
        is_current: true,
        description: "Dispensing, medication therapy management, patient counseling, inventory management, and prescription verification.",
        achievements: [],
      },
      {
        company: "University Lab",
        title: "Research Assistant",
        start_date: "2012",
        end_date: "2018",
        is_current: false,
        description: "Clinical lab techniques, molecular biology, animal models, qPCR, western blotting, and pharmacology research.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Doctor of Pharmacy",
        field: "Pharmacy",
        start_date: "2008",
        end_date: "2012",
        gpa: null,
      },
    ],
    skills: {
      technical: [
        "Pharmacology",
        "Pharmacy Practice",
        "Patient Care",
        "Clinical Laboratory Techniques",
        "Molecular Biology",
        "Animal Models",
        "qPCR",
        "Western Blotting",
      ],
      soft: ["Communication"],
      languages: [],
      certifications: [],
    },
    projects: [],
    certifications: null,
    seniority_level: "senior",
    years_of_experience: 13,
    primary_role: "Pharmacist / Research Assistant",
    industries: ["Healthcare", "Pharmaceuticals", "Research"],
    top_skills: [
      "Pharmacology",
      "Research",
      "Animal models",
      "Clinical lab techniques",
      "Molecular biology",
      "Patient care",
      "Teaching",
    ],
    resume_score: null,
    ats_score: null,
    raw_text: "Pharmacist Research Assistant Pharmacology Patient care Clinical lab techniques Molecular biology Animal models qPCR Western blotting",
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "job-1",
    company_id: "company-1",
    title: "Staff Pharmacist (PRN) - Infectious Diseases",
    department: null,
    location: "Chicago, IL",
    is_remote: false,
    is_hybrid: false,
    employment_type: "fulltime",
    seniority_level: "senior",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    description: "Requirements: Pharmacist role with medication therapy management, patient counseling, inventory management, and customer support.",
    apply_url: "https://example.com/job",
    external_id: null,
    first_detected_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    is_active: true,
    sponsors_h1b: null,
    sponsorship_score: 0,
    visa_language_detected: null,
    requires_authorization: false,
    skills: ["Inventory Management", "Customer Support"],
    normalized_title: null,
    raw_data: null,
    h1b_prediction: null,
    h1b_prediction_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

test("same-profession healthcare matches are not crushed by sparse extracted skills", () => {
  const resume = makeHealthcareResume()
  const job = makeJob({})
  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score >= 90, `expected Staff Pharmacist score >= 90, got ${score.overall_score}`)
  assert.equal(score.score_breakdown?.roleFamily, "healthcare")
  assert.equal(score.score_breakdown?.roleFamilyScore, 100)
})

test("same-profession software matches can reach the excellent band", () => {
  const resume = makeHealthcareResume({
    id: "resume-tech-1",
    file_name: "software.pdf",
    name: "Software Candidate",
    summary: "Software engineer with backend platform and applied AI experience.",
    work_experience: [
      {
        company: "Platform Co",
        title: "Software Engineer",
        start_date: "2018",
        end_date: null,
        is_current: true,
        description: "Built backend platform services with TypeScript, Node.js, APIs, AWS, and distributed systems.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2010",
        end_date: "2014",
        gpa: null,
      },
    ],
    skills: {
      technical: ["TypeScript", "Node.js", "AWS", "API Development", "Backend Development"],
      soft: ["Mentoring"],
      languages: [],
      certifications: [],
    },
    seniority_level: "senior",
    years_of_experience: 8,
    primary_role: "Software Engineer",
    industries: ["Technology"],
    top_skills: ["TypeScript", "Node.js", "AWS", "API Development", "Backend Development"],
    raw_text: "Software Engineer TypeScript Node.js AWS API Development Backend Development",
  })
  const job = makeJob({
    id: "job-software-1",
    title: "Senior Software Engineer - Backend Platform",
    description: "Requirements: TypeScript, Node.js, distributed systems, API development, and mentoring.",
    skills: ["TypeScript", "Node.js", "Distributed Systems", "API Development", "Mentoring"],
  })
  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score >= 90, `expected software score >= 90, got ${score.overall_score}`)
  assert.equal(score.score_breakdown?.roleFamily, "tech")
  assert.equal(score.score_breakdown?.roleFamilyScore, 100)
})

test("same broad healthcare family does not make cross-specialty roles high confidence", () => {
  const resume = makeHealthcareResume()
  const job = makeJob({
    id: "job-nurse-1",
    title: "Registered Nurse",
    description: "Requirements: active RN license, nursing care plans, medication administration, patient assessment, and hospital charting.",
    skills: ["Patient Care", "Clinical Laboratory Techniques", "Molecular Biology", "Nursing Care Plans", "RN License"],
  })
  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score < 70, `expected nurse score < 70, got ${score.overall_score}`)
})

test("resume experience text contributes skill evidence when skill buckets are sparse", () => {
  const resume = makeHealthcareResume({
    id: "resume-experience-skills-1",
    file_name: "backend.pdf",
    name: "Backend Candidate",
    summary: "Backend engineer focused on API platforms.",
    work_experience: [
      {
        company: "Platform Co",
        title: "Backend Engineer",
        start_date: "2020",
        end_date: null,
        is_current: true,
        description: "Built Python APIs with Django, PostgreSQL, Docker, and AWS for distributed services.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2014",
        end_date: "2018",
        gpa: null,
      },
    ],
    skills: {
      technical: [],
      soft: [],
      languages: [],
      certifications: [],
    },
    projects: [],
    seniority_level: "senior",
    years_of_experience: 6,
    primary_role: "Backend Engineer",
    industries: ["Technology"],
    top_skills: [],
    raw_text: null,
  })
  const job = makeJob({
    id: "job-backend-sparse-resume-1",
    title: "Senior Backend Engineer",
    description: "Requirements: Python, Django, PostgreSQL, Docker, AWS, and API development.",
    skills: ["Python", "Django", "PostgreSQL", "Docker", "AWS", "API Development"],
    seniority_level: "senior",
  })

  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score >= 85, `expected experience-derived skills to score strongly, got ${score.overall_score}`)
  assert.deepEqual(
    score.score_breakdown?.matchedSkills.slice(0, 5),
    ["Python", "Django", "PostgreSQL", "Docker", "AWS"]
  )
})

test("unsupported stored executive seniority is ignored for IC AI roles", () => {
  const resume = makeHealthcareResume({
    id: "resume-ai-ic-1",
    file_name: "ai-engineer.pdf",
    name: "AI Engineer Candidate",
    summary: "Senior software engineer focused on applied AI systems.",
    work_experience: [
      {
        company: "Platform Co",
        title: "AI Engineer",
        start_date: "2018",
        end_date: null,
        is_current: true,
        description: "Built Python, FastAPI, TypeScript, PostgreSQL, AWS, LLM, RAG, and agentic AI systems.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2010",
        end_date: "2014",
        gpa: null,
      },
    ],
    skills: {
      technical: ["Python", "FastAPI", "TypeScript", "PostgreSQL", "AWS", "LLMs", "RAG", "Agentic AI"],
      soft: [],
      languages: [],
      certifications: [],
    },
    projects: [],
    seniority_level: "senior",
    years_of_experience: 8,
    primary_role: "Software Engineer, Applied AI",
    industries: ["Technology"],
    top_skills: ["Python", "FastAPI", "TypeScript", "PostgreSQL", "AWS", "LLMs", "RAG", "Agentic AI"],
    raw_text: null,
  })
  const job = makeJob({
    id: "job-ai-ic-stale-exec-1",
    title: "AI Engineer",
    description:
      "Our CTO sets the technical and AI vision. Our Director of Product owns the roadmap. Requirements: Python, FastAPI, TypeScript, PostgreSQL, AWS, LLMs, RAG, and agentic AI.",
    skills: ["Python", "FastAPI", "TypeScript", "PostgreSQL", "AWS", "LLMs", "RAG", "Agentic AI"],
    seniority_level: "exec",
  })

  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score >= 90, `expected unsupported exec label to be ignored, got ${score.overall_score}`)
  assert.equal(score.score_breakdown?.seniorityScore, 75)
  assert.ok(
    score.score_breakdown?.concerns.some((concern) =>
      concern.includes("Unsupported stored seniority (exec) ignored")
    ),
    "expected ignored stale seniority to be surfaced"
  )
})

test("under-level candidates do not score excellent on staff roles by years alone", () => {
  const resume = makeHealthcareResume({
    id: "resume-mid-to-staff-1",
    file_name: "mid-software.pdf",
    name: "Mid Software Candidate",
    summary: "Software engineer with backend platform experience.",
    work_experience: [
      {
        company: "Platform Co",
        title: "Software Engineer",
        start_date: "2017",
        end_date: null,
        is_current: true,
        description: "Built TypeScript, Node.js, AWS, distributed systems, and API development.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2010",
        end_date: "2014",
        gpa: null,
      },
    ],
    skills: {
      technical: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
      soft: [],
      languages: [],
      certifications: [],
    },
    projects: [],
    seniority_level: "mid",
    years_of_experience: 9,
    primary_role: "Software Engineer",
    industries: ["Technology"],
    top_skills: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
    raw_text: null,
  })
  const job = makeJob({
    id: "job-staff-software-1",
    title: "Staff Software Engineer",
    description: "Requirements: TypeScript, Node.js, AWS, distributed systems, and API development.",
    skills: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
    seniority_level: "staff",
  })

  const score = computeFastScore({
    resume,
    job,
    profile: { ...baseProfile, seniority_level: "mid" },
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.score_breakdown?.experienceScore === 100, "expected years to meet the role")
  assert.ok((score.score_breakdown?.seniorityScore ?? 100) < 65, "expected seniority level mismatch")
  assert.ok(score.overall_score <= 72, `expected staff-role mismatch cap, got ${score.overall_score}`)
  assert.ok(
    score.score_breakdown?.concerns.some((concern) => concern.includes("seniority_mismatch")),
    "expected seniority mismatch gate to be surfaced"
  )
})

test("over-level candidates are capped on junior roles despite strong skills", () => {
  const resume = makeHealthcareResume({
    id: "resume-staff-to-junior-1",
    file_name: "staff-software.pdf",
    name: "Staff Software Candidate",
    summary: "Staff software engineer with backend platform experience.",
    work_experience: [
      {
        company: "Platform Co",
        title: "Staff Software Engineer",
        start_date: "2014",
        end_date: null,
        is_current: true,
        description: "Built TypeScript, Node.js, AWS, distributed systems, and API development.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2010",
        end_date: "2014",
        gpa: null,
      },
    ],
    skills: {
      technical: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
      soft: [],
      languages: [],
      certifications: [],
    },
    projects: [],
    seniority_level: "staff",
    years_of_experience: 12,
    primary_role: "Staff Software Engineer",
    industries: ["Technology"],
    top_skills: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
    raw_text: null,
  })
  const job = makeJob({
    id: "job-junior-software-1",
    title: "Junior Software Engineer",
    description: "Requirements: TypeScript, Node.js, AWS, distributed systems, and API development.",
    skills: ["TypeScript", "Node.js", "AWS", "Distributed Systems", "API Development"],
    seniority_level: "junior",
  })

  const score = computeFastScore({
    resume,
    job,
    profile: { ...baseProfile, seniority_level: "staff" },
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.score_breakdown?.experienceScore === 100, "expected years to meet the role")
  assert.ok((score.score_breakdown?.seniorityScore ?? 100) < 60, "expected over-level seniority penalty")
  assert.ok(score.overall_score <= 78, `expected junior-role mismatch cap, got ${score.overall_score}`)
  assert.equal(score.is_seniority_match, false)
})

test("sparse same-family postings with no skill support stay below strong match", () => {
  const resume = makeHealthcareResume({
    id: "resume-tech-no-skill-support-1",
    file_name: "software-no-support.pdf",
    name: "Software Candidate",
    summary: "Software engineer with backend platform experience.",
    work_experience: [
      {
        company: "Platform Co",
        title: "Software Engineer",
        start_date: "2018",
        end_date: null,
        is_current: true,
        description: "Built backend platform services and internal tooling.",
        achievements: [],
      },
    ],
    education: [
      {
        institution: "University",
        degree: "Bachelor of Science",
        field: "Computer Science",
        start_date: "2010",
        end_date: "2014",
        gpa: null,
      },
    ],
    skills: {
      technical: [],
      soft: [],
      languages: [],
      certifications: [],
    },
    projects: [],
    seniority_level: "senior",
    years_of_experience: 8,
    primary_role: "Software Engineer",
    industries: ["Technology"],
    top_skills: [],
    raw_text: null,
  })
  const job = makeJob({
    id: "job-sparse-no-skill-support-1",
    title: "Senior Software Engineer",
    description: "Requirements: Rust and Kubernetes.",
    skills: ["Rust", "Kubernetes"],
    seniority_level: "senior",
  })

  const score = computeFastScore({
    resume,
    job,
    profile: baseProfile,
    resumeContext: buildFastScoreResumeContext(resume),
  })

  assert.ok(score.overall_score < 70, `expected sparse no-skill-support score < 70, got ${score.overall_score}`)
  assert.ok(
    score.score_breakdown?.concerns.some((concern) => concern.includes("low_signal_skills_lt5")),
    "expected low-signal gate to be surfaced"
  )
})
