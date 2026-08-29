export type AutoApplyCriteria = {
  /** Minimum match score (0-100) to qualify for auto-apply */
  minMatchScore: number
  /** Only auto-apply to roles with a positive sponsorship signal */
  requireSponsorshipSignal: boolean
  /** If non-empty, only apply to these locations / "Remote" */
  allowedLocations: string[]
  /** If non-empty, only apply to these employment types */
  allowedEmploymentTypes: ("fulltime" | "contract" | "internship")[]
  /** Daily cap — Apex will not auto-apply to more than this many jobs per day */
  dailyCap: number
  /** If true, generate a tailored cover letter before submitting */
  generateCoverLetter: boolean
}

export type AutoApplyPreferences = {
  enabled: boolean
  criteria: AutoApplyCriteria
  /** ISO timestamp of when auto-apply was last toggled on */
  enabledAt: string | null
}

export type AutoApplyRecord = {
  id: string
  jobId: string
  jobTitle: string
  company: string | null
  matchScore: number | null
  appliedAt: string
  /** Which criteria qualified this job */
  qualifiedBy: Partial<AutoApplyCriteria>
  coverLetterId: string | null
  tailoredResumeId: string | null
  /** dry_run = the full pipeline ran but deliberately stopped before submitting. */
  status: "applied" | "failed" | "skipped_cap" | "dry_run"
  error: string | null
  applyUrl?: string | null
  ats?: string | null
  /** Groups this application's AI calls in api_usage.run_id. */
  runId?: string | null
  /** How complete the filled form was — the quality signal behind a run. */
  requiredTotal?: number | null
  requiredFilled?: number | null
}

export const AUTO_APPLY_DEFAULTS: AutoApplyCriteria = {
  minMatchScore: 85,
  requireSponsorshipSignal: false,
  allowedLocations: [],
  allowedEmploymentTypes: ["fulltime"],
  dailyCap: 5,
  generateCoverLetter: true,
}
