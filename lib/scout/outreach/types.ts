/**
 * Scout Recruiter Copilot + Outreach Intelligence — Types V1
 *
 * ScoutOutreachDraft is a server-generated draft message the user can edit
 * and copy. Scout never sends messages automatically.
 *
 * Safety contract:
 *   - Scout generates; user reviews, edits, and manually sends
 *   - Never fabricates relationships, references, or referrals
 *   - Never claims sponsorship guarantees
 *   - Never impersonates the user
 *   - Never mass-messages (one draft at a time, triggered by explicit user command)
 */

export type ScoutOutreachType =
  | "linkedin_message"    // LinkedIn DM to recruiter or hiring manager
  | "email"               // cold or warm email outreach
  | "follow_up"           // post-application or post-interview follow-up
  | "referral_request"    // asking a contact for a referral

export type ScoutOutreachTone =
  | "professional"   // formal, confident, specific — default
  | "warm"           // conversational, good for referral requests
  | "direct"         // very concise, no pleasantries — for busy hiring managers

export type ScoutOutreachDraft = {
  id:             string

  type:           ScoutOutreachType
  tone?:          ScoutOutreachTone

  companyId?:     string
  jobId?:         string

  /** Recipient details — may be unknown ([Name] placeholder used in draft) */
  recipientName?: string
  recipientRole?: string

  /** The generated message body — ready to copy and edit */
  draft:          string

  /** 3–5 specific talking points derived from resume/job context */
  talkingPoints?: string[]

  /** Which context sources contributed to this draft */
  generatedFrom?: {
    job?:          boolean
    companyIntel?: boolean
    resume?:       boolean
  }

  /**
   * Cautious warnings Scout surfaces alongside the draft.
   * E.g. "Mention sponsorship only if you know this company sponsors."
   * Max 2. Keep concise.
   */
  warnings?: string[]
}

// ── Type labels + icons (used by OutreachMode UI) ─────────────────────────────

export const OUTREACH_TYPE_LABELS: Record<ScoutOutreachType, string> = {
  linkedin_message: "LinkedIn Message",
  email:            "Email Draft",
  follow_up:        "Follow-Up",
  referral_request: "Referral Request",
}

export const OUTREACH_TONE_LABELS: Record<ScoutOutreachTone, string> = {
  professional: "Professional",
  warm:         "Warm",
  direct:       "Direct",
}

// Character limits per outreach type (soft — shown in editor, not enforced)
export const OUTREACH_CHAR_LIMITS: Record<ScoutOutreachType, number> = {
  linkedin_message: 1200,
  email:            2000,
  follow_up:        700,
  referral_request: 1000,
}
