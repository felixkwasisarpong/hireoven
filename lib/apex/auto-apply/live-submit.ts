/**
 * Live-submit gating for overnight auto-apply.
 *
 * AUTO_APPLY_ALLOW_SUBMIT is the global arming switch. AUTO_APPLY_SUBMIT_ALLOWLIST
 * is optional: when unset, every otherwise-eligible Pro Max opted-in account can
 * submit; when set, it restricts submit to listed account ids/emails.
 */

export const AUTO_APPLY_SUBMIT_ALLOWLIST_ENV = "AUTO_APPLY_SUBMIT_ALLOWLIST"
export const AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST_ENV =
  "AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST"

export type AutoApplySubmitIdentity = {
  userId: string
  email?: string | null
}

type AutoApplySubmitEnv = Partial<Record<
  | "AUTO_APPLY_ALLOW_SUBMIT"
  | "AUTO_APPLY_SUBMIT_ALLOWLIST"
  | "AUTO_APPLY_POST_SUBMIT_OUTREACH"
  | "AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST",
  string
>>

export function parseAutoApplySubmitAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

function identityMatchesAllowlist(
  identity: AutoApplySubmitIdentity,
  allowlist: Set<string>,
): boolean {
  if (allowlist.has("*")) return true

  const userId = identity.userId.trim().toLowerCase()
  const email = identity.email?.trim().toLowerCase() ?? ""
  return allowlist.has(userId) || (email.length > 0 && allowlist.has(email))
}

export function isAutoApplyLiveSubmitAllowed(
  identity: AutoApplySubmitIdentity,
  env: AutoApplySubmitEnv = process.env as AutoApplySubmitEnv,
): boolean {
  if (env.AUTO_APPLY_ALLOW_SUBMIT !== "true") return false

  const allowlist = parseAutoApplySubmitAllowlist(env.AUTO_APPLY_SUBMIT_ALLOWLIST)
  if (allowlist.size === 0) return true
  return identityMatchesAllowlist(identity, allowlist)
}

export function isAutoApplyPostSubmitOutreachAllowed(
  identity: AutoApplySubmitIdentity,
  env: AutoApplySubmitEnv = process.env as AutoApplySubmitEnv,
): boolean {
  if (env.AUTO_APPLY_POST_SUBMIT_OUTREACH !== "true") return false

  const allowlist = parseAutoApplySubmitAllowlist(
    env.AUTO_APPLY_POST_SUBMIT_OUTREACH_ALLOWLIST,
  )
  if (allowlist.size === 0) return false
  return identityMatchesAllowlist(identity, allowlist)
}
