/**
 * Scout Agent Guardrails + Permission System — V1
 *
 * Controls what Scout and the extension overlay are allowed to do.
 * Persists to localStorage so user choices survive page refreshes.
 * Audit log goes to sessionStorage (clears on browser close, never stores values).
 *
 * Hard rules that can NEVER be changed:
 *   - No auto-submit of applications
 *   - No silent overwrite of original resumes
 *   - No answering sensitive legal questions without explicit user input
 *   - No hidden actions that bypass this permission system
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoutPermission =
  | "read_jobs"
  | "read_resume"
  | "tailor_resume"
  | "generate_cover_letter"
  | "autofill_fields"
  | "insert_cover_letter"
  | "attach_resume"
  | "open_external_pages"
  | "queue_applications"

export type ScoutPermissionState = {
  permission: ScoutPermission
  allowed: boolean
  /** When true, user must confirm before each execution */
  requiresConfirmation: boolean
  updatedAt: string
}

export type PermissionCheck = {
  allowed: boolean
  reason?: string
  requiresConfirmation?: boolean
}

export type ScoutAuditLogEntry = {
  id: string
  actionType: string
  permission: ScoutPermission | "hard_blocked"
  timestamp: number
  approved: boolean
  /** "always_allowed" | "confirmed_once" | "always_allowed_updated" | "blocked" | "cancelled" */
  approvalMode: string
  source?: string
  pageContext?: string
}

// ── Hard-blocked actions — can NEVER be unlocked ──────────────────────────────

/** These map to action strings that are completely forbidden regardless of user settings. */
export const HARD_BLOCKED_ACTIONS = new Set([
  "submit_application",
  "auto_submit",
  "silent_resume_overwrite",
  "answer_sensitive_legal",
])

// ── Permission defaults ───────────────────────────────────────────────────────

type PermissionDefault = Pick<ScoutPermissionState, "allowed" | "requiresConfirmation">

const PERMISSION_DEFAULTS: Record<ScoutPermission, PermissionDefault> = {
  read_jobs:             { allowed: true, requiresConfirmation: false },
  read_resume:           { allowed: true, requiresConfirmation: false },
  tailor_resume:         { allowed: true, requiresConfirmation: true  },
  generate_cover_letter: { allowed: true, requiresConfirmation: true  },
  autofill_fields:       { allowed: true, requiresConfirmation: true  },
  insert_cover_letter:   { allowed: true, requiresConfirmation: true  },
  attach_resume:         { allowed: true, requiresConfirmation: true  },
  open_external_pages:   { allowed: true, requiresConfirmation: true  },
  queue_applications:    { allowed: true, requiresConfirmation: true  },
}

/** Human-readable labels for the permissions panel */
export const PERMISSION_LABELS: Record<ScoutPermission, { name: string; description: string }> = {
  read_jobs:             { name: "Read jobs",            description: "View job listings and company info" },
  read_resume:           { name: "Read resume",          description: "Access your resume for context and scoring" },
  tailor_resume:         { name: "Tailor resume",        description: "Create tailored resume versions (originals are never changed)" },
  generate_cover_letter: { name: "Generate cover letter", description: "Draft AI cover letters for review before use" },
  autofill_fields:       { name: "Autofill fields",      description: "Fill application form fields on the active page" },
  insert_cover_letter:   { name: "Insert cover letter",  description: "Paste cover letter text into the active form" },
  attach_resume:         { name: "Attach resume",        description: "Attach a resume file to an application form" },
  open_external_pages:   { name: "Open external pages",  description: "Navigate to external job pages and company sites" },
  queue_applications:    { name: "Queue applications",   description: "Add jobs to the application workflow queue" },
}

// ── Action → Permission mapping ───────────────────────────────────────────────

export const ACTION_PERMISSION: Record<string, ScoutPermission> = {
  // Dashboard Scout actions
  OPEN_JOB:                        "read_jobs",
  APPLY_FILTERS:                   "read_jobs",
  HIGHLIGHT_JOBS:                  "read_jobs",
  OPEN_COMPANY:                    "read_jobs",
  SET_FOCUS_MODE:                  "read_jobs",
  RESET_CONTEXT:                   "read_jobs",
  OPEN_EXTENSION_BRIDGE:           "read_jobs",
  OPEN_EXTENSION_AUTOFILL_PREVIEW: "read_jobs",
  OPEN_RESUME_TAILOR:              "read_resume",
  PREPARE_TAILORED_AUTOFILL:       "tailor_resume",

  // Extension overlay actions
  autofill:                        "autofill_fields",
  "fill-safe":                     "autofill_fields",
  "reload-autofill":               "autofill_fields",
  "review-fields":                 "autofill_fields",
  tailor:                          "tailor_resume",
  "approve-tailor":                "tailor_resume",
  "open-tailor-editor":            "open_external_pages",
  cover:                           "generate_cover_letter",
  "generate-cover":                "generate_cover_letter",
  "insert-cover":                  "insert_cover_letter",
  "open-dashboard":                "open_external_pages",
  "open-job":                      "open_external_pages",
  "menu-open":                     "open_external_pages",
  save:                            "read_jobs",
  match:                           "read_jobs",
  "queue-next":                    "read_jobs",
  signin:                          "read_jobs",

  // Workflow / queue
  queue_applications:              "queue_applications",
  START_WORKFLOW:                  "queue_applications",
  OPEN_AUTOFILL:                   "autofill_fields",
  START_TAILOR:                    "tailor_resume",
}

// ── Storage ───────────────────────────────────────────────────────────────────

const PERM_KEY  = "hireoven:scout-permissions:v1"
const AUDIT_KEY = "hireoven:scout-audit-log:v1"
const MAX_AUDIT = 50

export function getDefaultPermissions(): ScoutPermissionState[] {
  return (Object.keys(PERMISSION_DEFAULTS) as ScoutPermission[]).map((p) => ({
    permission: p,
    ...PERMISSION_DEFAULTS[p],
    updatedAt: new Date().toISOString(),
  }))
}

export function readPermissions(): ScoutPermissionState[] {
  if (typeof window === "undefined") return getDefaultPermissions()
  try {
    const raw = localStorage.getItem(PERM_KEY)
    if (!raw) return getDefaultPermissions()
    const parsed = JSON.parse(raw) as ScoutPermissionState[]
    // Merge with defaults so newly added permissions get sensible values
    const stored = new Map(parsed.map((p) => [p.permission, p]))
    return getDefaultPermissions().map((d) => stored.get(d.permission) ?? d)
  } catch {
    return getDefaultPermissions()
  }
}

export function writePermissions(states: ScoutPermissionState[]): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(PERM_KEY, JSON.stringify(states)) } catch {}
}

export function resetPermissions(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(PERM_KEY) } catch {}
}

export function updatePermission(
  current: ScoutPermissionState[],
  permission: ScoutPermission,
  patch: Partial<Pick<ScoutPermissionState, "allowed" | "requiresConfirmation">>,
): ScoutPermissionState[] {
  const updated = current.map((s) =>
    s.permission === permission
      ? { ...s, ...patch, updatedAt: new Date().toISOString() }
      : s
  )
  writePermissions(updated)
  return updated
}

// ── Validation ────────────────────────────────────────────────────────────────

export function checkPermission(
  actionType: string,
  permissions: ScoutPermissionState[],
): PermissionCheck {
  // Hard-blocked: forbidden regardless of settings
  if (HARD_BLOCKED_ACTIONS.has(actionType)) {
    return {
      allowed: false,
      reason: `"${actionType}" is permanently blocked — Scout cannot submit applications or overwrite resumes automatically.`,
    }
  }

  const permission = ACTION_PERMISSION[actionType]
  if (!permission) {
    // Unknown action — allow but no confirmation needed (it's a read-only nav action)
    return { allowed: true, requiresConfirmation: false }
  }

  const state = permissions.find((p) => p.permission === permission)
  if (!state) return { allowed: true, requiresConfirmation: false }

  if (!state.allowed) {
    return {
      allowed: false,
      reason: `"${PERMISSION_LABELS[permission].name}" is currently disabled in Scout permissions.`,
    }
  }

  return {
    allowed: true,
    requiresConfirmation: state.requiresConfirmation,
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export function logAuditEntry(entry: ScoutAuditLogEntry): void {
  if (typeof window === "undefined") return
  try {
    const raw = sessionStorage.getItem(AUDIT_KEY)
    const log: ScoutAuditLogEntry[] = raw ? (JSON.parse(raw) as ScoutAuditLogEntry[]) : []
    log.unshift(entry)
    // Rolling window — never exceed MAX_AUDIT entries
    sessionStorage.setItem(AUDIT_KEY, JSON.stringify(log.slice(0, MAX_AUDIT)))
  } catch {}
}

export function readAuditLog(): ScoutAuditLogEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(AUDIT_KEY)
    return raw ? (JSON.parse(raw) as ScoutAuditLogEntry[]) : []
  } catch {
    return []
  }
}

export function clearAuditLog(): void {
  if (typeof window === "undefined") return
  try { sessionStorage.removeItem(AUDIT_KEY) } catch {}
}

// ── Confirmation copy generator ───────────────────────────────────────────────

export function buildConfirmationCopy(actionType: string): { title: string; description: string } {
  const permission = ACTION_PERMISSION[actionType]
  const defaults = {
    title: "Scout wants to perform an action",
    description: "Confirm to allow Scout to proceed.",
  }

  if (!permission) return defaults

  const map: Partial<Record<ScoutPermission, { title: string; description: string }>> = {
    tailor_resume:         { title: "Tailor your resume",           description: "Scout will create a tailored version for this role. Your original resume is never changed." },
    generate_cover_letter: { title: "Generate a cover letter",      description: "Scout will draft a cover letter based on this job. You review and edit before using it." },
    autofill_fields:       { title: "Autofill application fields",  description: "Scout will fill form fields from your profile. Sensitive fields are excluded and must be filled manually." },
    insert_cover_letter:   { title: "Insert cover letter into form", description: "Scout will paste your cover letter into the detected text field. You must still click Submit." },
    attach_resume:         { title: "Attach a resume file",        description: "Scout will attach a resume to the file upload. You approve before any form is submitted." },
    open_external_pages:   { title: "Open an external page",       description: "Scout wants to navigate to a company page or application URL." },
    queue_applications:    { title: "Queue this application",      description: "Scout will add this role to your application workflow queue for you to review." },
  }

  return map[permission] ?? defaults
}
