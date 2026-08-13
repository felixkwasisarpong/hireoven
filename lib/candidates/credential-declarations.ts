/**
 * Candidate credential declarations — what the candidate told us, kept strictly
 * apart from what we could find on their résumé.
 *
 * The whole reason this module exists is one distinction:
 *
 *   NOT_FOUND        we looked at readable data and did not find it
 *   ABSENT_CONFIRMED the candidate told us they do not have it
 *
 * Only the second is evidence about the person. The first is evidence about a
 * document. Collapsing them into a boolean is how a résumé that simply omits a
 * licence turns into "this candidate is unqualified" — which is wrong often
 * enough, and consequentially enough, to be worth a whole type.
 *
 * Pure helpers live here and are unit-tested; the DB helpers are thin wrappers
 * over one indexed lookup, following the repo convention of keeping decision
 * logic in lib/** and out of route handlers.
 */

import { getPostgresPool } from "@/lib/postgres/server"

// ─── Vocabulary ──────────────────────────────────────────────────────────────
// Mirrors docs/application-xray/xray-contract.ts. Kept as plain unions here so
// this module has no dependency on the (still proposed) X-Ray contract.

export type RequirementPresence =
  | "PRESENT"
  | "ABSENT_CONFIRMED"
  | "NOT_FOUND"
  | "CONTRADICTED"
  | "UNKNOWN"

export type ContradictionReliability =
  | "declaration_vs_structured_field"
  | "declaration_vs_free_text"
  | "free_text_internal"

export type RequirementStrength =
  | "MANDATORY_EXPLICIT"
  | "PREFERRED_EXPLICIT"
  | "INFERRED"
  | "UNKNOWN"

export type RequirementStrengthProvenance =
  | "deterministic_pattern"
  | "structured_ats_field"
  | "section_header_plus_pattern"
  | "llm_only"
  | "none"

export type AcquirabilitySource = "candidate_declared" | "credential_catalog" | "unknown"

export type CredentialSearchLocation = "structured_field" | "raw_text" | "candidate_declaration"

export type CandidateCredentialDeclaration = {
  id: string
  user_id: string
  credential_key: string
  credential_label: string
  held: boolean
  expected_at: string | null
  note: string | null
  source: "prompt" | "profile" | "import"
  declared_at: string
  updated_at: string
}

// ─── Key normalization ───────────────────────────────────────────────────────

/** Common ways a posting writes the same credential. Deliberately small and
 *  explicit: a fuzzy matcher here would silently merge distinct credentials
 *  (CISSP vs CISSP-ISSAP), and a wrong merge produces a wrong SKIP. */
const CREDENTIAL_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcertified public accountant\b/i, "cpa"],
  [/\bproject management professional\b/i, "pmp"],
  [/\bcertified information systems security professional\b/i, "cissp"],
  [/\bcertified kubernetes administrator\b/i, "cka"],
  [/\bcertified kubernetes application developer\b/i, "ckad"],
  [/\bcertified kubernetes security specialist\b/i, "cks"],
  [/\bcertified ethical hacker\b/i, "ceh"],
  [/\bts\s*\/\s*sci\b/i, "clearance-ts-sci"],
  [/\btop[\s-]?secret\b/i, "clearance-top-secret"],
  [/\bsecret clearance\b/i, "clearance-secret"],
  [/\bpublic[\s-]?trust\b/i, "clearance-public-trust"],
]

/**
 * Stable lookup key for a credential label. Lower-cased, punctuation stripped,
 * whitespace collapsed to single hyphens, with a short alias table for the
 * spelled-out forms.
 *
 * Returns "" for input with no usable characters; callers must treat an empty
 * key as "not a credential we can track" rather than storing it.
 */
export function normalizeCredentialKey(label: string | null | undefined): string {
  const raw = (label ?? "").trim()
  if (!raw) return ""

  for (const [pattern, key] of CREDENTIAL_ALIASES) {
    if (pattern.test(raw)) return key
  }

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// ─── Presence resolution ─────────────────────────────────────────────────────

export type ResolvePresenceInput = {
  /** The candidate's declaration for this credential, if they have made one. */
  declaration: Pick<CandidateCredentialDeclaration, "held"> | null
  /** Matched a parsed structured field (resumes.skills.certifications,
   *  education, work_experience). Higher trust than free text. */
  structuredFieldMatch: boolean
  /** Matched only free-text résumé content (resumes.raw_text). */
  freeTextMatch: boolean
  /** False when the résumé is absent or unparsed — i.e. we could not look at
   *  all. Distinct from looking and finding nothing. */
  candidateDataReadable: boolean
}

export type ResolvePresenceResult = {
  presence: RequirementPresence
  /** Set only when presence is CONTRADICTED. */
  contradictionReliability: ContradictionReliability | null
  /** Where we actually looked, so the UI can say so honestly. */
  searchedIn: CredentialSearchLocation[]
}

/**
 * Resolve what we know about the candidate holding a credential.
 *
 * A declaration always wins over document evidence, in both directions — the
 * candidate is a better source about themselves than a parser is. The one case
 * that is neither PRESENT nor ABSENT_CONFIRMED is a declaration of "I don't
 * have it" against data that says otherwise; that is surfaced as CONTRADICTED
 * with a reliability level, because a structured field disagreeing is worth
 * acting on and a stray free-text mention is not.
 *
 * Note the asymmetry: a declaration of "I hold it" against a résumé that does
 * not mention it is NOT a contradiction. Silence is not a competing claim.
 */
export function resolveRequirementPresence(input: ResolvePresenceInput): ResolvePresenceResult {
  const searchedIn: CredentialSearchLocation[] = []
  if (input.declaration) searchedIn.push("candidate_declaration")
  if (input.candidateDataReadable) {
    searchedIn.push("structured_field", "raw_text")
  }

  if (input.declaration) {
    if (input.declaration.held) {
      // They told us they have it. A résumé that omits it does not dispute that.
      return { presence: "PRESENT", contradictionReliability: null, searchedIn }
    }
    if (input.structuredFieldMatch) {
      return {
        presence: "CONTRADICTED",
        contradictionReliability: "declaration_vs_structured_field",
        searchedIn,
      }
    }
    if (input.freeTextMatch) {
      return {
        presence: "CONTRADICTED",
        contradictionReliability: "declaration_vs_free_text",
        searchedIn,
      }
    }
    return { presence: "ABSENT_CONFIRMED", contradictionReliability: null, searchedIn }
  }

  // No declaration. Document evidence can establish presence but never absence.
  if (!input.candidateDataReadable) {
    return { presence: "UNKNOWN", contradictionReliability: null, searchedIn }
  }
  if (input.structuredFieldMatch || input.freeTextMatch) {
    return { presence: "PRESENT", contradictionReliability: null, searchedIn }
  }
  return { presence: "NOT_FOUND", contradictionReliability: null, searchedIn }
}

// ─── Hard-skip eligibility ───────────────────────────────────────────────────

export type SupportsHardSkipInput = {
  strength: RequirementStrength
  strengthProvenance: RequirementStrengthProvenance
  presence: RequirementPresence
  contradictionReliability: ContradictionReliability | null
  acquirabilitySource: AcquirabilitySource
  /** Candidate-declared days until they expect to hold it. */
  acquirabilityEstimatedDays: number | null
  /** How long the opportunity plausibly stays open. A credential arriving
   *  inside that window is not a reason to skip. */
  opportunityWindowDays: number | null
}

/**
 * Whether a missing requirement is solid enough to justify skipping the job.
 *
 * This is the single gate the decision table reads for a requirement-based
 * SKIP, and it is deliberately hard to satisfy. Every clause below exists to
 * stop a specific wrong skip:
 *
 *  - MANDATORY_EXPLICIT only — a "preferred" or inferred requirement is not a
 *    bar the employer will enforce.
 *  - Never on llm_only provenance — a model deciding something is mandatory is
 *    not the employer saying so, and model output drifts between runs.
 *  - Never on NOT_FOUND or UNKNOWN — those are statements about a document, not
 *    about a person.
 *  - CONTRADICTED only at structured-field reliability — a stray free-text
 *    mention disagreeing with a declaration is noise.
 *  - Never when the candidate says it is arriving inside the hiring window.
 */
export function supportsHardSkip(input: SupportsHardSkipInput): boolean {
  if (input.strength !== "MANDATORY_EXPLICIT") return false
  if (input.strengthProvenance === "llm_only" || input.strengthProvenance === "none") return false

  const absenceIsEstablished =
    input.presence === "ABSENT_CONFIRMED" ||
    (input.presence === "CONTRADICTED" &&
      input.contradictionReliability === "declaration_vs_structured_field")
  if (!absenceIsEstablished) return false

  if (
    input.acquirabilitySource === "candidate_declared" &&
    typeof input.acquirabilityEstimatedDays === "number" &&
    Number.isFinite(input.acquirabilityEstimatedDays) &&
    typeof input.opportunityWindowDays === "number" &&
    input.acquirabilityEstimatedDays <= input.opportunityWindowDays
  ) {
    return false
  }

  return true
}

/**
 * Days until a declared acquisition date. Null when not declared, unparseable,
 * or already past — a lapsed expectation is not an estimate, it is a prompt to
 * re-ask.
 */
export function declaredAcquisitionDays(
  expectedAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expectedAt) return null
  const target = Date.parse(expectedAt)
  if (!Number.isFinite(target)) return null
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  return days >= 0 ? days : null
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** All declarations for one candidate, keyed for direct lookup. */
export async function loadCredentialDeclarations(
  userId: string
): Promise<Map<string, CandidateCredentialDeclaration>> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CandidateCredentialDeclaration>(
    `SELECT id, user_id, credential_key, credential_label, held,
            expected_at::text, note, source,
            declared_at::text, updated_at::text
       FROM candidate_credential_declarations
      WHERE user_id = $1`,
    [userId]
  )
  return new Map(rows.map((row) => [row.credential_key, row]))
}

/** Record or update one answer. Re-answering overwrites in place. */
export async function upsertCredentialDeclaration(input: {
  userId: string
  credentialLabel: string
  held: boolean
  expectedAt?: string | null
  note?: string | null
  source?: "prompt" | "profile" | "import"
}): Promise<string | null> {
  const key = normalizeCredentialKey(input.credentialLabel)
  if (!key) return null

  const pool = getPostgresPool()
  const { rows } = await pool.query<{ credential_key: string }>(
    `INSERT INTO candidate_credential_declarations
       (user_id, credential_key, credential_label, held, expected_at, note, source)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'prompt'))
     ON CONFLICT (user_id, credential_key) DO UPDATE SET
       credential_label = EXCLUDED.credential_label,
       held             = EXCLUDED.held,
       expected_at      = EXCLUDED.expected_at,
       note             = EXCLUDED.note,
       source           = EXCLUDED.source,
       updated_at       = NOW()
     RETURNING credential_key`,
    [
      input.userId,
      key,
      input.credentialLabel.trim(),
      input.held,
      input.expectedAt ?? null,
      input.note ?? null,
      input.source ?? null,
    ]
  )
  return rows[0]?.credential_key ?? null
}

/**
 * Withdraw an answer, returning the credential to NOT_FOUND / UNKNOWN.
 *
 * Callers must invalidate any cached decision derived from this credential —
 * a SKIP that rested on the declaration is no longer supported once it is gone.
 */
export async function deleteCredentialDeclaration(
  userId: string,
  credentialKey: string
): Promise<boolean> {
  const pool = getPostgresPool()
  const { rowCount } = await pool.query(
    `DELETE FROM candidate_credential_declarations
      WHERE user_id = $1 AND credential_key = $2`,
    [userId, credentialKey]
  )
  return (rowCount ?? 0) > 0
}
