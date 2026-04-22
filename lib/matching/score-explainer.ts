import { getSeniorityGap } from "@/lib/matching/fast-scorer"
import type {
  Job,
  JobMatchScore,
  Resume,
  ScoreExplanation,
} from "@/types"

function normalizeSkill(value: string) {
  return value.trim().toLowerCase()
}

function getResumeSkills(resume: Resume) {
  return new Set(
    [
      ...(resume.top_skills ?? []),
      ...(resume.skills?.technical ?? []),
      ...(resume.skills?.certifications ?? []),
    ]
      .map(normalizeSkill)
      .filter(Boolean)
  )
}

export function explainScore(
  score: JobMatchScore,
  resume: Resume,
  job: Job
): ScoreExplanation {
  const strengths: string[] = []
  const concerns: string[] = []
  const resumeSkills = getResumeSkills(resume)
  const missingSkills = (job.skills ?? []).filter(
    (skill) =>
      !Array.from(resumeSkills).some(
        (resumeSkill) =>
          resumeSkill === normalizeSkill(skill) ||
          resumeSkill.includes(normalizeSkill(skill)) ||
          normalizeSkill(skill).includes(resumeSkill)
      )
  )

  if ((score.skills_score ?? 0) >= 75) {
    strengths.push(
      `${score.matching_skills_count} of ${Math.max(
        score.total_required_skills,
        1
      )} visible skills align with this role.`
    )
  } else if (missingSkills.length > 0) {
    concerns.push(`Missing or weak coverage on: ${missingSkills.slice(0, 3).join(", ")}.`)
  }

  const seniorityGap = getSeniorityGap(resume.seniority_level, job.seniority_level)
  if ((score.seniority_score ?? 0) >= 70) {
    strengths.push("Your experience level lines up well with the role’s seniority.")
  } else if (seniorityGap !== null && seniorityGap < 0) {
    concerns.push("This looks like a stretch on seniority based on your current resume.")
  } else if (seniorityGap !== null && seniorityGap > 1) {
    concerns.push("You may be somewhat overqualified for this level.")
  }

  if ((score.location_score ?? 0) >= 80) {
    strengths.push(job.is_remote ? "The role is remote, so location is a clean fit." : "The role location matches your search preferences.")
  } else if ((score.location_score ?? 0) < 70) {
    concerns.push("Location is a weaker fit for your current search preferences.")
  }

  if ((score.sponsorship_score ?? 0) >= 80) {
    strengths.push("The company shows a strong sponsorship signal for international candidates.")
  } else if (score.is_sponsorship_compatible === false) {
    concerns.push("Sponsorship compatibility is weak for your current work authorization needs.")
  }

  let headline = "Potential fit - worth a closer look"
  if (score.overall_score >= 85) {
    headline = "Strong match - this role lines up well with your background"
  } else if (score.overall_score >= 70) {
    headline = "Good match - the fundamentals line up, with a few gaps to close"
  } else if (score.overall_score < 50) {
    headline = "Lower match - there are some meaningful gaps to review first"
  }

  const sponsorshipNote = score.is_sponsorship_compatible
    ? "This role looks reasonably compatible with your sponsorship situation."
    : resume.user_id && job.requires_authorization
      ? "This posting signals tighter work authorization requirements than your profile prefers."
      : null

  return {
    headline,
    strengths: strengths.slice(0, 3),
    concerns: concerns.slice(0, 3),
    sponsorship_note: sponsorshipNote,
  }
}
