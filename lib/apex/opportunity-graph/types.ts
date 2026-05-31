/**
 * Scout Opportunity Graph — Types V1
 *
 * Lightweight relationship engine connecting jobs, companies, skills,
 * roles, and the user's profile. All relationships are evidence-backed.
 *
 * Safety rules:
 *   - No fabricated career outcomes
 *   - No implied guaranteed transitions
 *   - No fake similarity scores
 *   - Evidence required for every relationship claim
 */

// ── Relationship model (spec-aligned) ────────────────────────────────────────

export type OpportunityNodeType = "job" | "company" | "skill" | "role" | "sector"

export type OpportunityRelationshipType =
  | "similar_role"
  | "skill_overlap"
  | "common_transition"
  | "sponsorship_pattern"
  | "same_hiring_cluster"
  | "career_progression"
  | "market_similarity"

export type OpportunityRelationship = {
  id:               string
  sourceType:       OpportunityNodeType
  sourceId:         string
  targetType:       OpportunityNodeType
  targetId:         string
  relationshipType: OpportunityRelationshipType
  /** 0–1, based on overlap count or industry match */
  strength:         number
  evidence?:        string[]
}

// ── Higher-level recommendations (surfaced to UI + Scout chat) ────────────────

export type OpportunityRecommendationType =
  | "similar_job"
  | "adjacent_company"
  | "skill_unlock"
  | "sponsorship_alternative"
  | "career_progression"

export type OpportunityConfidence = "high" | "medium" | "low"

export type OpportunityRecommendation = {
  id:           string
  type:         OpportunityRecommendationType
  title:        string
  subtitle?:    string
  description:  string
  evidence:     string[]
  /** Pre-built Scout command bar query — user clicks to launch */
  query:        string
  confidence:   OpportunityConfidence
  /** IDs of related entities (jobId, companyId, skill name) */
  entityIds?:   string[]
}

// ── API response shape ────────────────────────────────────────────────────────

export type OpportunityGraphResponse = {
  similarJobs:          SimilarJobHit[]
  adjacentCompanies:    AdjacentCompanyHit[]
  skillUnlocks:         SkillUnlockHit[]
  careerProgression?:   CareerProgressionHit[]
  recommendations:      OpportunityRecommendation[]
  generatedAt:          string
}

export type SimilarJobHit = {
  jobId:          string
  title:          string
  companyName:    string
  companyId:      string
  overlapCount:   number
  overlapSkills:  string[]
  sponsorsH1b:    boolean | null
  isRemote:       boolean
  strength:       number
}

export type AdjacentCompanyHit = {
  companyId:       string
  companyName:     string
  industry:        string | null
  sponsorsH1b:     boolean
  matchingJobCount:number
  commonSkills:    string[]
  strength:        number
}

export type SkillUnlockHit = {
  skill:      string
  jobCount:   number
  /** How many MORE jobs this skill would unlock given user's current skill set */
  netUnlock:  number
  categories: string[]
}

export type CareerProgressionHit = {
  targetRole:        string
  seniorityStep:     "lateral" | "up" | "adjacent"
  skillGap:          string[]
  description:       string
  confidence:        OpportunityConfidence
}
