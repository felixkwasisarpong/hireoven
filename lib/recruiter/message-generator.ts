// =============================================================================
// Recruiter Message Generator
// Produces professional, non-desperate sponsorship inquiry messages.
// These are templates — the user must edit and send them manually.
// This is NOT legal advice.
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserImmigrationStage =
  | "opt"
  | "stem_opt"
  | "h1b_current"
  | "needs_future_h1b"
  | "citizen_gc"
  | "unknown"

export type RecruiterMessageStage =
  | "before_applying"
  | "recruiter_outreach"
  | "during_screening"
  | "stem_opt_i983"
  | "future_h1b"
  | "after_offer"

export type MessageTone = "concise" | "warm" | "direct"

export type GeneratedMessage = {
  id: RecruiterMessageStage
  label: string
  description: string
  /** For email channels */
  subject: string
  /** Full message body */
  body: string
  /** Trimmed LinkedIn/short version (≤300 chars) */
  linkedInVersion: string
  /** Even shorter SMS/quick-reply version */
  shortVersion: string
}

export type RecruiterMessageInput = {
  userStatus: UserImmigrationStage
  jobTitle: string
  company: string
  /** Optional — replaces "Hiring Manager" or "Recruiter" */
  recruiterName?: string | null
  tone: MessageTone
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greeting(name: string | null | undefined): string {
  return name ? `Hi ${name},` : "Hi there,"
}

function statusLine(status: UserImmigrationStage): string {
  switch (status) {
    case "opt":
      return "I'm currently on OPT"
    case "stem_opt":
      return "I'm currently on STEM OPT"
    case "h1b_current":
      return "I'm currently on H-1B"
    case "needs_future_h1b":
      return "I'll need H-1B sponsorship within the next few years"
    case "citizen_gc":
      return "I'm a US citizen / permanent resident and no sponsorship is needed"
    default:
      return "I wanted to ask a quick question about work authorization"
  }
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

function beforeApplying(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)
  const status = statusLine(input.userStatus)

  const body =
    tone === "concise"
      ? `${greet}\n\nI came across the ${jobTitle} opening at ${company} and I'm very interested in applying.\n\nQuick question: ${status}. Does ${company} consider candidates who require work authorization for this role?\n\nThanks for your time. Happy to share my resume if it's a fit.\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nI hope you're doing well! I recently came across the ${jobTitle} role at ${company} and was excited by the opportunity, which aligns well with my background.\n\nBefore applying, I wanted to ask: ${status}. Is sponsorship something ${company} typically considers for this type of role?\n\nI appreciate any clarity you can offer, and I'm happy to provide more details about my background.\n\nWarm regards`
        : `${greet}\n\nI'm interested in the ${jobTitle} position at ${company}.\n\n${status}. Does ${company} sponsor candidates for this role? Please let me know before I submit my application.\n\nThank you.`

  const linkedInVersion = `Hi${recruiterName ? ` ${recruiterName}` : ""}! I'm interested in the ${jobTitle} role at ${company}. ${status}. Does ${company} consider candidates who need work authorization? Happy to chat if it's a fit.`

  const shortVersion = `Hi! Interested in your ${jobTitle} role. ${status}. Does ${company} sponsor for this position?`

  return {
    id: "before_applying",
    label: "Before Applying",
    description: "Send before submitting your application to confirm sponsorship eligibility.",
    subject: `Question Before Applying: ${jobTitle} at ${company}`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

function recruiterOutreach(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)
  const status = statusLine(input.userStatus)

  const body =
    tone === "concise"
      ? `${greet}\n\nThank you for reaching out about the ${jobTitle} role at ${company}. It sounds like an exciting opportunity.\n\nI'm happy to learn more. One thing I'd love to confirm early on: ${status}. Is that something ${company} can support?\n\nLooking forward to connecting.\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nThank you so much for reaching out! The ${jobTitle} opportunity at ${company} looks like a great fit for my background, and I'd love to explore it further.\n\nI want to be upfront so we don't waste each other's time: ${status}. Is sponsorship something ${company} is open to for this role?\n\nLooking forward to hearing from you.\n\nWarm regards`
        : `${greet}\n\nThanks for reaching out about ${jobTitle} at ${company}.\n\nI'm interested. ${status}. Can ${company} support that for this role?\n\nLet me know and we can schedule a call.\n\nThank you.`

  const linkedInVersion = `Thanks for reaching out about ${jobTitle} at ${company}! I'm interested. Quick question: ${status}. Is that something ${company} supports? Happy to chat if so.`

  const shortVersion = `Thanks for reaching out! ${status}. Does ${company} sponsor for this role?`

  return {
    id: "recruiter_outreach",
    label: "Reply to Recruiter",
    description: "Use when a recruiter contacts you first. Show interest while clarifying sponsorship.",
    subject: `Re: ${jobTitle} Opportunity at ${company}`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

function duringScreening(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)
  const status = statusLine(input.userStatus)

  const body =
    tone === "concise"
      ? `${greet}\n\nThank you for the screening call. I enjoyed learning more about the ${jobTitle} role at ${company}.\n\nI wanted to circle back on something I should have raised earlier: ${status}. Is this something the team is able to accommodate?\n\nHappy to discuss further.\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nThank you again for the great conversation about the ${jobTitle} position at ${company}! I came away even more excited about the opportunity.\n\nI also wanted to follow up on one important detail: ${status}. I want to make sure this isn't a blocker as we move forward. Is it something ${company} can support?\n\nThank you for your transparency, and I'm looking forward to next steps.\n\nWarm regards`
        : `${greet}\n\nThanks for the screening call regarding the ${jobTitle} role.\n\n${status}. I should confirm this before we go further. Can ${company} accommodate that?\n\nThank you.`

  const linkedInVersion = `Thanks for the screening call! One thing to confirm: ${status}. Is that something ${company} can support for the ${jobTitle} role?`

  const shortVersion = `Quick follow-up: ${status}. Can ${company} support that for this role?`

  return {
    id: "during_screening",
    label: "During Screening",
    description: "Use after a screening call to clarify sponsorship before advancing.",
    subject: `Follow-Up: ${jobTitle} at ${company} - Work Authorization Question`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

function stemOptI983(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)

  const body =
    tone === "concise"
      ? `${greet}\n\nI'm excited about the ${jobTitle} opportunity at ${company}. I wanted to raise one practical question early: I'm on STEM OPT, which requires a training plan (Form I-983) to be completed and signed by the employer. Is ${company} familiar with this process and able to complete it?\n\nThis is a straightforward administrative step, and I can walk the team through it if helpful.\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nI really enjoyed our conversation about the ${jobTitle} role at ${company} and I remain very enthusiastic about the opportunity.\n\nI wanted to bring up one practical question: I'm on STEM OPT, which requires a training plan (Form I-983) to be submitted to my university. This is typically handled by HR and involves confirming that the role provides relevant training. Is this something ${company} has done before or would be open to completing?\n\nI'm happy to share more information and make the process as simple as possible.\n\nWarm regards`
        : `${greet}\n\nI'm on STEM OPT, which requires the employer to complete a training plan (Form I-983). Is ${company} able to sign off on this for the ${jobTitle} role? It's an administrative document. I can send details.\n\nThank you.`

  const linkedInVersion = `Hi! Excited about the ${jobTitle} role at ${company}. I'm on STEM OPT, which requires a training plan (Form I-983) signed by the employer. Has ${company} done this before? Happy to share details if needed.`

  const shortVersion = `I'm on STEM OPT, which requires an I-983 training plan from ${company}. Is that something you're able to complete?`

  return {
    id: "stem_opt_i983",
    label: "STEM OPT / I-983",
    description: "Ask whether the employer can complete the I-983 training plan for STEM OPT.",
    subject: `STEM OPT Training Plan (I-983): ${jobTitle} at ${company}`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

function futureH1b(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)

  const body =
    tone === "concise"
      ? `${greet}\n\nI'm very interested in the ${jobTitle} position at ${company}. I'm currently authorized to work and don't require immediate sponsorship. However, I'll need H-1B sponsorship within the next few years.\n\nIs this something ${company} has supported for employees in similar roles?\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nThank you again for the opportunity to discuss the ${jobTitle} role at ${company}. I'm genuinely excited about the potential fit.\n\nI want to be transparent about one thing: I'm currently authorized to work without sponsorship, but I'll need H-1B sponsorship in the coming years. I've seen that ${company} has sponsored employees in the past. Is this something the company plans to continue supporting?\n\nThank you for your time and candidness.\n\nWarm regards`
        : `${greet}\n\nI don't need sponsorship now, but I will need H-1B sponsorship within the next couple of years. Does ${company} sponsor employees for ${jobTitle} roles long-term?\n\nThank you.`

  const linkedInVersion = `Hi! Interested in the ${jobTitle} role at ${company}. I'm currently authorized to work, but will need H-1B sponsorship in the coming years. Does ${company} typically support that path for employees?`

  const shortVersion = `I'm work-authorized now but will need H-1B sponsorship in a couple of years. Does ${company} support that for ${jobTitle} roles?`

  return {
    id: "future_h1b",
    label: "Future H-1B Sponsorship",
    description: "Ask about long-term sponsorship plans when you're currently authorized but will need H-1B.",
    subject: `Long-Term Sponsorship Question: ${jobTitle} at ${company}`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

function afterOffer(input: RecruiterMessageInput): GeneratedMessage {
  const { jobTitle, company, recruiterName, tone } = input
  const greet = greeting(recruiterName)
  const status = statusLine(input.userStatus)

  const body =
    tone === "concise"
      ? `${greet}\n\nThank you so much for the offer for the ${jobTitle} role! I'm thrilled and looking forward to joining ${company}.\n\nTo make sure everything moves smoothly on the onboarding side: ${status}. Can you confirm the sponsorship process and expected timeline so I can plan accordingly?\n\nBest regards`
      : tone === "warm"
        ? `${greet}\n\nI'm so grateful to receive an offer for the ${jobTitle} role at ${company}! I'm genuinely excited about the team and the opportunity ahead.\n\nAs I prepare for onboarding, I want to make sure we're aligned on one important detail: ${status}. Could you let me know what the next steps look like on the sponsorship side, including any forms or timelines I should be aware of?\n\nThank you again. Looking forward to getting started!\n\nWarm regards`
        : `${greet}\n\nThank you for the offer for ${jobTitle}. ${status}. What are the next steps and expected timeline for initiating the sponsorship process?\n\nThank you.`

  const linkedInVersion = `Thank you for the offer for the ${jobTitle} role at ${company}! ${status}. What are the next steps on sponsorship so I can plan my timeline?`

  const shortVersion = `Thanks for the offer! ${status}. What are the next steps and timeline for sponsorship?`

  return {
    id: "after_offer",
    label: "After Offer",
    description: "Confirm sponsorship logistics after receiving a job offer.",
    subject: `Re: Offer for ${jobTitle} - Sponsorship Next Steps`,
    body,
    linkedInVersion,
    shortVersion,
  }
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate all 6 recruiter message templates for a given job and user status.
 * Returns all messages so the UI can let the user pick which one to use.
 *
 * IMPORTANT: These are templates. The user must review, edit, and send them
 * manually. This is NOT legal advice.
 */
export function generateRecruiterMessages(
  input: RecruiterMessageInput
): GeneratedMessage[] {
  const safe: RecruiterMessageInput = {
    ...input,
    jobTitle: input.jobTitle || "this role",
    company: input.company || "your company",
    recruiterName: input.recruiterName?.trim() || null,
  }

  return [
    beforeApplying(safe),
    recruiterOutreach(safe),
    duringScreening(safe),
    stemOptI983(safe),
    futureH1b(safe),
    afterOffer(safe),
  ]
}

/**
 * Generate a single message for a specific stage.
 */
export function generateRecruiterMessage(
  input: RecruiterMessageInput,
  stage: RecruiterMessageStage
): GeneratedMessage {
  const safe: RecruiterMessageInput = {
    ...input,
    jobTitle: input.jobTitle || "this role",
    company: input.company || "your company",
    recruiterName: input.recruiterName?.trim() || null,
  }

  switch (stage) {
    case "before_applying":
      return beforeApplying(safe)
    case "recruiter_outreach":
      return recruiterOutreach(safe)
    case "during_screening":
      return duringScreening(safe)
    case "stem_opt_i983":
      return stemOptI983(safe)
    case "future_h1b":
      return futureH1b(safe)
    case "after_offer":
      return afterOffer(safe)
  }
}

/**
 * Map VisaStatus (from types/index.ts) to UserImmigrationStage.
 */
export function visaStatusToImmigrationStage(
  status: string | null | undefined
): UserImmigrationStage {
  switch (status) {
    case "opt":
      return "opt"
    case "stem_opt":
      return "stem_opt"
    case "h1b":
      return "h1b_current"
    case "citizen":
    case "green_card":
      return "citizen_gc"
    default:
      return "unknown"
  }
}
