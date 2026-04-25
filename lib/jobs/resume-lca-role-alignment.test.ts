import test from "node:test"
import assert from "node:assert/strict"
import { calculateResumeLcaRoleAlignment } from "@/lib/jobs/resume-lca-role-alignment"

test("calculateResumeLcaRoleAlignment scores strong LCA and job alignment", () => {
  const result = calculateResumeLcaRoleAlignment({
    resumeText:
      "Software engineer with React, TypeScript, Node.js, PostgreSQL, REST APIs, AWS, and Docker experience.",
    resumeSkills: ["React", "TypeScript", "Node.js", "SQL", "AWS", "Docker"],
    jobTitle: "Senior Full Stack Engineer",
    jobDescription:
      "Build React and TypeScript interfaces, Node.js services, REST APIs, and deploy with AWS and Docker.",
    historicalSponsoredRoleKeywords: ["React", "TypeScript", "Node.js", "SQL"],
    companyCommonSkills: ["AWS", "Docker"],
  })

  assert.equal(result.roleFamily, "Software Engineering")
  assert.ok((result.alignmentScore ?? 0) >= 80)
  assert.ok(result.strongMatches.includes("React"))
  assert.ok(result.strongMatches.includes("TypeScript"))
  assert.equal(result.source, "mixed")
})

test("calculateResumeLcaRoleAlignment identifies missing keywords without fabricating experience", () => {
  const result = calculateResumeLcaRoleAlignment({
    resumeText: "Frontend developer with React, JavaScript, and Figma experience.",
    resumeSkills: ["React", "JavaScript", "Figma"],
    jobTitle: "Platform Engineer",
    jobDescription: "Work with Kubernetes, Terraform, AWS, Docker, and Go services.",
    historicalSponsoredRoleKeywords: ["Kubernetes", "Terraform", "AWS", "Docker", "Go"],
  })

  assert.ok((result.alignmentScore ?? 100) < 50)
  assert.ok(result.missingKeywords.includes("Kubernetes"))
  assert.ok(result.missingKeywords.includes("Terraform"))
  assert.ok(result.resumeRewriteSuggestions.some((suggestion) => /only if it is true/i.test(suggestion)))
})

test("calculateResumeLcaRoleAlignment falls back to job description when LCA data is unavailable", () => {
  const result = calculateResumeLcaRoleAlignment({
    resumeText: "Data engineer with Python, SQL, Airflow, and Spark pipeline work.",
    resumeSkills: ["Python", "SQL", "Airflow", "Spark"],
    jobTitle: "Data Engineer",
    jobDescription: "Python, SQL, Airflow, Spark, and AWS required.",
  })

  assert.equal(result.roleFamily, "Data Engineering")
  assert.equal(result.source, "job_description")
  assert.ok((result.alignmentScore ?? 0) >= 55)
  assert.ok(result.explanation.includes("falls back"))
})

test("calculateResumeLcaRoleAlignment returns low-confidence unknown without resume text", () => {
  const result = calculateResumeLcaRoleAlignment({
    resumeText: null,
    resumeSkills: null,
    jobTitle: "Machine Learning Engineer",
    jobDescription: "Python, machine learning, deep learning, and SQL.",
  })

  assert.equal(result.alignmentScore, null)
  assert.equal(result.confidence, "low")
  assert.ok(result.explanation.includes("Upload or select"))
})
