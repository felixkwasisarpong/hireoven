import type {
  EmploymentType,
  Job,
  JobMatchScoreInsert,
  Profile,
  Resume,
  SeniorityLevel,
  Skills,
} from "@/types"

export interface FastScoreInput {
  resume: Resume
  job: Job
  profile: Profile
}

const SENIORITY_MAP: Record<SeniorityLevel, number> = {
  intern: 1,
  junior: 2,
  mid: 3,
  senior: 4,
  staff: 5,
  principal: 6,
  director: 7,
  vp: 8,
  exec: 9,
}

function normalizeTerm(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9+#./ -]/g, "")
}

function uniqueTerms(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (value ?? "").split(","))
        .map((value) => normalizeTerm(value))
        .filter(Boolean)
    )
  )
}

function getResumeTechnicalSkills(skills: Skills | null) {
  if (!skills) return []
  return [...skills.technical, ...skills.certifications, ...skills.languages]
}

function calculateSkillScore(jobSkills: string[] | null, resume: Resume) {
  if (!jobSkills?.length) {
    return {
      skillsScore: 60,
      matchingSkillsCount: 0,
      totalRequiredSkills: 0,
      skillsMatchRate: 0.6,
    }
  }

  const requiredSkills = uniqueTerms(jobSkills)
  const candidateSkills = uniqueTerms([
    ...(resume.top_skills ?? []),
    ...getResumeTechnicalSkills(resume.skills ?? null),
  ])

  if (requiredSkills.length === 0) {
    return {
      skillsScore: 60,
      matchingSkillsCount: 0,
      totalRequiredSkills: 0,
      skillsMatchRate: 0.6,
    }
  }

  let matchedPoints = 0
  let matchingSkillsCount = 0

  for (const required of requiredSkills) {
    let bestMatch = 0

    for (const candidate of candidateSkills) {
      if (candidate === required) {
        bestMatch = 1
        break
      }

      if (
        candidate.includes(required) ||
        required.includes(candidate)
      ) {
        bestMatch = Math.max(bestMatch, 0.8)
      }
    }

    if (bestMatch >= 0.6) matchingSkillsCount += 1
    matchedPoints += bestMatch
  }

  const skillsMatchRate = Number((matchedPoints / requiredSkills.length).toFixed(3))

  return {
    skillsScore: Math.round(skillsMatchRate * 100),
    matchingSkillsCount,
    totalRequiredSkills: requiredSkills.length,
    skillsMatchRate,
  }
}

export function getSeniorityGap(
  candidateLevel: SeniorityLevel | null | undefined,
  jobLevel: SeniorityLevel | null | undefined
) {
  if (!candidateLevel || !jobLevel) return null
  return SENIORITY_MAP[candidateLevel] - SENIORITY_MAP[jobLevel]
}

function calculateSeniorityScore(
  candidateLevel: SeniorityLevel | null | undefined,
  jobLevel: SeniorityLevel | null | undefined
) {
  const gap = getSeniorityGap(candidateLevel, jobLevel)

  if (gap === null) {
    return { seniorityScore: 60, isSeniorityMatch: true, seniorityGap: null }
  }

  if (gap === 0) return { seniorityScore: 100, isSeniorityMatch: true, seniorityGap: gap }
  if (gap === 1) return { seniorityScore: 80, isSeniorityMatch: true, seniorityGap: gap }
  if (gap === -1) return { seniorityScore: 70, isSeniorityMatch: true, seniorityGap: gap }
  if (gap === 2) return { seniorityScore: 50, isSeniorityMatch: false, seniorityGap: gap }
  if (gap <= -2) return { seniorityScore: 30, isSeniorityMatch: false, seniorityGap: gap }

  return { seniorityScore: 40, isSeniorityMatch: false, seniorityGap: gap }
}

function includesDesiredLocation(jobLocation: string | null, desiredLocations: string[]) {
  if (!jobLocation) return false
  const normalizedLocation = normalizeTerm(jobLocation)
  return desiredLocations.some((location) => normalizedLocation.includes(normalizeTerm(location)))
}

function calculateLocationScore(profile: Profile, job: Job) {
  const desiredLocations = profile.desired_locations?.filter(Boolean) ?? []

  if (job.is_remote) {
    return { locationScore: 100, isLocationMatch: true }
  }

  if (profile.remote_only && !job.is_remote) {
    return { locationScore: 0, isLocationMatch: false }
  }

  if (includesDesiredLocation(job.location, desiredLocations)) {
    return { locationScore: 100, isLocationMatch: true }
  }

  if (job.is_hybrid) {
    return { locationScore: 80, isLocationMatch: true }
  }

  if (desiredLocations.length === 0) {
    return { locationScore: 70, isLocationMatch: true }
  }

  return { locationScore: 40, isLocationMatch: false }
}

function employmentTypeEquivalent(value: EmploymentType | null | undefined) {
  if (!value) return null
  if (value === "fulltime") return "fulltime"
  return value
}

function calculateEmploymentTypeScore(profile: Profile, job: Job) {
  const desiredTypes = profile.desired_employment_types?.filter(Boolean) ?? []

  if (desiredTypes.length === 0) {
    return { employmentTypeScore: 80, isEmploymentTypeMatch: true }
  }

  const desiredSet = new Set(desiredTypes.map((value) => employmentTypeEquivalent(value)))
  const jobType = employmentTypeEquivalent(job.employment_type)

  if (!jobType) {
    return { employmentTypeScore: 60, isEmploymentTypeMatch: true }
  }

  if (desiredSet.has(jobType)) {
    return { employmentTypeScore: 100, isEmploymentTypeMatch: true }
  }

  return { employmentTypeScore: 30, isEmploymentTypeMatch: false }
}

function calculateSponsorshipScore(profile: Profile, job: Job) {
  if (!profile.needs_sponsorship) {
    return { sponsorshipScore: 100, isSponsorshipCompatible: true }
  }

  if (job.sponsors_h1b === true) {
    return { sponsorshipScore: 100, isSponsorshipCompatible: true }
  }

  if ((job.sponsorship_score ?? 0) >= 80) {
    return { sponsorshipScore: 85, isSponsorshipCompatible: true }
  }

  if ((job.sponsorship_score ?? 0) >= 60) {
    return { sponsorshipScore: 65, isSponsorshipCompatible: true }
  }

  if (job.requires_authorization === true) {
    return { sponsorshipScore: 0, isSponsorshipCompatible: false }
  }

  if ((job.sponsorship_score ?? 0) < 30) {
    return { sponsorshipScore: 20, isSponsorshipCompatible: false }
  }

  return { sponsorshipScore: 50, isSponsorshipCompatible: false }
}

export function getResumeVersion(resume: Resume) {
  const updatedAt = new Date(resume.updated_at).getTime()
  if (Number.isFinite(updatedAt) && updatedAt > 0) {
    return Math.floor(updatedAt / 1000)
  }
  return 1
}

export function computeFastScore({
  resume,
  job,
  profile,
}: FastScoreInput): JobMatchScoreInsert {
  const { skillsScore, matchingSkillsCount, totalRequiredSkills, skillsMatchRate } =
    calculateSkillScore(job.skills, resume)
  const { seniorityScore, isSeniorityMatch, seniorityGap } = calculateSeniorityScore(
    resume.seniority_level,
    job.seniority_level
  )
  const { locationScore, isLocationMatch } = calculateLocationScore(profile, job)
  const { employmentTypeScore, isEmploymentTypeMatch } =
    calculateEmploymentTypeScore(profile, job)
  const { sponsorshipScore, isSponsorshipCompatible } =
    calculateSponsorshipScore(profile, job)

  let overallScore = Math.round(
    skillsScore * 0.4 +
      seniorityScore * 0.25 +
      locationScore * 0.15 +
      employmentTypeScore * 0.1 +
      sponsorshipScore * 0.1
  )

  const hasHardDisqualifier =
    (!job.is_remote && profile.remote_only) ||
    (job.requires_authorization && profile.needs_sponsorship) ||
    (seniorityGap !== null && Math.abs(seniorityGap) > 3)

  if (hasHardDisqualifier) {
    overallScore = Math.min(overallScore, 25)
  }

  return {
    user_id: resume.user_id,
    resume_id: resume.id,
    job_id: job.id,
    overall_score: overallScore,
    skills_score: skillsScore,
    seniority_score: seniorityScore,
    location_score: locationScore,
    employment_type_score: employmentTypeScore,
    sponsorship_score: sponsorshipScore,
    is_seniority_match: isSeniorityMatch,
    is_location_match: isLocationMatch,
    is_employment_type_match: isEmploymentTypeMatch,
    is_sponsorship_compatible: isSponsorshipCompatible,
    matching_skills_count: matchingSkillsCount,
    total_required_skills: totalRequiredSkills,
    skills_match_rate: skillsMatchRate,
    score_method: "fast",
    computed_at: new Date().toISOString(),
    resume_version: getResumeVersion(resume),
  }
}
