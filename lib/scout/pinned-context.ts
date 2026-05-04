/**
 * Scout Pinned Context — V1
 *
 * Persists the active browser context (job, company, ATS) across Scout tab
 * navigations using sessionStorage. This survives page refreshes within the
 * same session but not browser restarts — intentionally lightweight.
 *
 * Written by ScoutWorkspaceShell whenever browserContext changes.
 * Read by the workflow engine and ContextRail to pre-seed job context.
 */

const KEY = "hireoven:scout-pinned-context:v1"
const MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours

export type PinnedBrowserContext = {
  /** Hireoven job ID if already resolved in this session */
  jobId?: string
  company?: string
  jobTitle?: string
  ats?: string
  pageUrl?: string
  workflowType?: string
  pinnedAt: number
}

export function readPinnedContext(): PinnedBrowserContext | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PinnedBrowserContext
    if (Date.now() - parsed.pinnedAt > MAX_AGE_MS) {
      clearPinnedContext()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writePinnedContext(ctx: Omit<PinnedBrowserContext, "pinnedAt">): void {
  if (typeof window === "undefined") return
  try {
    const full: PinnedBrowserContext = { ...ctx, pinnedAt: Date.now() }
    sessionStorage.setItem(KEY, JSON.stringify(full))
  } catch {
    // quota or private mode — fail silently
  }
}

export function clearPinnedContext(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(KEY)
  } catch {}
}
