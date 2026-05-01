export type ApplyAgentJobStatus =
  | "pending"        // waiting to be processed
  | "tailoring"      // resume being tailored
  | "confirming"     // waiting for user to confirm skills
  | "tailored"       // tailored resume ready
  | "opening"        // extension opening job URL
  | "filling"        // extension autofilling form
  | "applied"        // application submitted / marked done
  | "skipped"        // user skipped this job
  | "failed"         // error during process

export type ApplyAgentJob = {
  jobId:              string
  jobTitle:           string
  company:            string | null
  matchScore:         number | null
  applyUrl:           string | null
  sponsorshipSignal:  string | null
  location:           string | null
  isRemote:           boolean
  status:             ApplyAgentJobStatus
  tailoredResumeId?:  string
  coverLetterId?:     string
  error?:             string
}

export type SkillGap = {
  skill:     string
  inResume:  boolean // skill is already in resume
  inJob:     boolean // skill appears in JD
  include:   boolean // user's decision (default: true if in JD but not resume)
}

export type ApplyAgentDirective = {
  /** Jobs Scout selected to apply to — sorted by match score desc */
  jobs:         ApplyAgentJob[]
  /** Criteria used to select jobs */
  criteria: {
    minMatchScore?:          number
    requireSponsorshipSignal: boolean
    workMode?:               string
    count:                   number
  }
  /** Zero-indexed job the agent is currently working on */
  currentIndex: number
  /** Overall phase of the agent */
  phase:        "select" | "run" | "done"
}
