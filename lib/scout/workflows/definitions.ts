import type { ScoutActiveWorkflow, ScoutActiveWorkflowStep, ScoutWorkflowType } from "./types"

type WorkflowTemplate = Omit<ScoutActiveWorkflow, "id" | "completedAt" | "cancelledAt" | "pausedAt">

const TAILOR_AND_PREPARE: WorkflowTemplate = {
  title: "Tailor + Prepare Application",
  goal: "Prepare a tailored, ready-to-submit application package for this role",
  activeStepId: "resolve-job",
  steps: [
    {
      id: "resolve-job",
      title: "Resolve current job",
      description: "Confirm the target job is loaded and synced to Scout",
      status: "running",
      actionType: "RESOLVE_JOB",
    },
    {
      id: "analyze-requirements",
      title: "Analyze requirements",
      description: "Extract key skills, signals, and gaps from the job description",
      status: "pending",
      actionType: "ANALYZE_JOB",
    },
    {
      id: "tailor-resume",
      title: "Tailor resume",
      description: "Review Scout's suggested resume changes — approve before applying",
      status: "pending",
      actionType: "OPEN_RESUME_TAILOR",
      requiresConfirmation: true,
    },
    {
      id: "generate-cover-letter",
      title: "Generate cover letter",
      description: "Draft a targeted cover letter — review before using",
      status: "pending",
      actionType: "GENERATE_COVER_LETTER",
      requiresConfirmation: true,
    },
    {
      id: "prepare-autofill",
      title: "Prepare autofill profile",
      description: "Verify your autofill profile is ready for the application form",
      status: "pending",
      actionType: "PREPARE_AUTOFILL",
    },
    {
      id: "open-autofill-review",
      title: "Open autofill review",
      description: "Review all form fields in the extension before filling — you approve each field",
      status: "pending",
      actionType: "OPEN_EXTENSION_AUTOFILL_PREVIEW",
      requiresConfirmation: true,
    },
  ] satisfies ScoutActiveWorkflowStep[],
}

const COMPARE_AND_PRIORITIZE: WorkflowTemplate = {
  title: "Compare + Prioritize",
  goal: "Rank your saved jobs by fit and surface where to apply first",
  activeStepId: "gather-jobs",
  steps: [
    {
      id: "gather-jobs",
      title: "Gather saved jobs",
      description: "Load your watchlist and recent saves",
      status: "running",
      actionType: "GATHER_JOBS",
    },
    {
      id: "compare-match",
      title: "Compare match scores",
      description: "Score each job against your resume and profile",
      status: "pending",
      actionType: "COMPARE_MATCH",
    },
    {
      id: "compare-sponsorship",
      title: "Compare sponsorship signals",
      description: "Check H-1B and visa sponsorship likelihood for each role",
      status: "pending",
      actionType: "COMPARE_SPONSORSHIP",
    },
    {
      id: "compare-response",
      title: "Compare response likelihood",
      description: "Estimate employer response probability based on signals",
      status: "pending",
      actionType: "COMPARE_RESPONSE",
    },
    {
      id: "recommend-applications",
      title: "Recommend next applications",
      description: "Review Scout's prioritized shortlist — your decision to act",
      status: "pending",
      actionType: "RECOMMEND_APPLICATIONS",
      requiresConfirmation: true,
    },
  ] satisfies ScoutActiveWorkflowStep[],
}

const INTERVIEW_PREP: WorkflowTemplate = {
  title: "Interview Prep",
  goal: "Build a full interview preparation plan for this role",
  activeStepId: "analyze-job",
  steps: [
    {
      id: "analyze-job",
      title: "Analyze job",
      description: "Extract key responsibilities and required competencies",
      status: "running",
      actionType: "ANALYZE_JOB",
    },
    {
      id: "analyze-company",
      title: "Analyze company",
      description: "Research culture, stage, and likely interview format",
      status: "pending",
      actionType: "ANALYZE_COMPANY",
    },
    {
      id: "generate-questions",
      title: "Generate likely questions",
      description: "Predict the most likely behavioral and technical questions",
      status: "pending",
      actionType: "GENERATE_QUESTIONS",
    },
    {
      id: "generate-prep-plan",
      title: "Generate prep plan",
      description: "Build a structured study plan with talking points and gaps",
      status: "pending",
      actionType: "GENERATE_PREP_PLAN",
    },
    {
      id: "start-mock-interview",
      title: "Start mock interview",
      description: "Practice with an AI-guided mock interview session",
      status: "pending",
      actionType: "START_MOCK_INTERVIEW",
      requiresConfirmation: true,
    },
  ] satisfies ScoutActiveWorkflowStep[],
}

const TEMPLATES: Record<ScoutWorkflowType, WorkflowTemplate> = {
  tailor_and_prepare: TAILOR_AND_PREPARE,
  compare_and_prioritize: COMPARE_AND_PRIORITIZE,
  interview_prep: INTERVIEW_PREP,
}

export function preparePlan(
  type: ScoutWorkflowType | string,
  payload?: Record<string, unknown>
): ScoutActiveWorkflow {
  const template = TEMPLATES[type as ScoutWorkflowType] ?? TAILOR_AND_PREPARE
  const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const steps = template.steps.map((s, i) =>
    i === 0 && payload ? { ...s, payload } : { ...s }
  )
  return { ...template, id, steps }
}
