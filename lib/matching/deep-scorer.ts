import { analyzeResumeForJob } from "@/lib/resume/analyzer"
import { getResumeVersion } from "@/lib/matching/fast-scorer"
import type {
  Company,
  Job,
  JobMatchScore,
  JobMatchScoreInsert,
  Resume,
  ResumeAnalysis,
} from "@/types"

export function mapAnalysisToDeepScore(
  resume: Resume,
  job: Job,
  fastScore: JobMatchScore | JobMatchScoreInsert,
  analysis: ResumeAnalysis
): JobMatchScoreInsert {
  return {
    user_id: resume.user_id,
    resume_id: resume.id,
    job_id: job.id,
    overall_score: analysis.overall_score ?? fastScore.overall_score,
    skills_score: analysis.skills_score ?? fastScore.skills_score ?? null,
    seniority_score: fastScore.seniority_score ?? null,
    location_score: fastScore.location_score ?? null,
    employment_type_score: fastScore.employment_type_score ?? null,
    sponsorship_score: fastScore.sponsorship_score ?? null,
    is_seniority_match: fastScore.is_seniority_match ?? null,
    is_location_match: fastScore.is_location_match ?? null,
    is_employment_type_match: fastScore.is_employment_type_match ?? null,
    is_sponsorship_compatible: fastScore.is_sponsorship_compatible ?? null,
    matching_skills_count:
      analysis.matching_skills?.length ?? fastScore.matching_skills_count ?? 0,
    total_required_skills:
      job.skills?.length ?? fastScore.total_required_skills ?? 0,
    skills_match_rate:
      job.skills?.length && analysis.matching_skills
        ? Number((analysis.matching_skills.length / job.skills.length).toFixed(3))
        : fastScore.skills_match_rate ?? null,
    score_method: "deep",
    computed_at: new Date().toISOString(),
    resume_version: getResumeVersion(resume),
  }
}

export async function computeDeepScore(
  resume: Resume,
  job: Job & { company: Company },
  fastScore: JobMatchScore | JobMatchScoreInsert
): Promise<JobMatchScoreInsert> {
  const analysis = await analyzeResumeForJob(resume, job, resume.user_id)
  return mapAnalysisToDeepScore(resume, job, fastScore, analysis)
}
