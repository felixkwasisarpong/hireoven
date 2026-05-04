/**
 * Context-aware Scout suggestion chips and placeholder text.
 *
 * When the extension reports an active browser context, Scout adapts its
 * command bar chips and placeholder to reflect the user's current page
 * rather than showing generic Scout suggestions.
 */

import type { ActiveBrowserContext, ActiveBrowserPageType } from "./browser-context"

// ── Chip sets per page type ───────────────────────────────────────────────────

const CHIPS: Record<ActiveBrowserPageType, string[]> = {
  job_detail: [
    "Tailor resume for this role",
    "Compare with saved jobs",
    "Check sponsorship history",
    "Interview prep for this role",
  ],
  application_form: [
    "Review autofill fields",
    "Generate cover letter",
    "Check missing skills",
    "Prepare tailored application",
  ],
  search_results: [
    "Filter visa-friendly roles",
    "Show strongest matches",
    "Hide ghost jobs",
    "Compare top matches",
  ],
  company_page: [
    "Is this company worth targeting?",
    "Check sponsorship history",
    "Compare open roles here",
    "How many people work here?",
  ],
  unknown: [],
}

// ── Placeholder text per page type ───────────────────────────────────────────

const PLACEHOLDERS: Record<ActiveBrowserPageType, (ctx: ActiveBrowserContext) => string> = {
  search_results: () => "Find stronger matches from this search…",
  job_detail: (ctx) =>
    ctx.company
      ? `Tailor your resume for ${ctx.company}…`
      : "Tailor your resume for this role…",
  application_form: () => "Review autofill fields before applying…",
  company_page: (ctx) =>
    ctx.company
      ? `Ask Scout about ${ctx.company}…`
      : "Ask Scout about this company…",
  unknown: () => "",
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Returns context-sensitive chips if the extension has an actionable page type.
 * Returns null when context is absent or unknown — callers should fall back to
 * their default chip set.
 */
export function getContextualChips(ctx: ActiveBrowserContext | null): string[] | null {
  if (!ctx || ctx.pageType === "unknown") return null

  const base = CHIPS[ctx.pageType]
  if (!base.length) return null

  // Personalise the first chip with company name when available
  if (ctx.company && ctx.pageType === "job_detail") {
    return [
      `Tailor for ${ctx.company}`,
      ...base.slice(1),
    ]
  }

  return base
}

/**
 * Returns a context-aware command bar placeholder, or the provided fallback if
 * context is absent.
 */
export function getContextualPlaceholder(
  ctx: ActiveBrowserContext | null,
  fallback: string,
): string {
  if (!ctx || ctx.pageType === "unknown") return fallback
  const fn = PLACEHOLDERS[ctx.pageType]
  const text = fn(ctx)
  return text || fallback
}

/**
 * Human-readable label for the current browser context, used in the rail
 * or anywhere a short description of the active tab is useful.
 */
export function getBrowserContextLabel(ctx: ActiveBrowserContext): string {
  switch (ctx.pageType) {
    case "job_detail":
      if (ctx.title && ctx.company) return `${ctx.title} · ${ctx.company}`
      if (ctx.title) return ctx.title
      if (ctx.company) return ctx.company
      return "Job detail"
    case "application_form":
      return ctx.company ? `Applying to ${ctx.company}` : "Application form"
    case "search_results":
      return "Job search results"
    case "company_page":
      return ctx.company ? `${ctx.company} company page` : "Company page"
    default:
      return "Browser tab"
  }
}
