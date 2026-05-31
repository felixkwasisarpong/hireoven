/**
 * CTA fatigue suppression for aggregator pills.
 *
 * Two layers:
 *   1. Per-session dismiss counter (chrome.storage.session). After 3 dismissals
 *      on a single site in a single browser session, suppress that site's pill
 *      for the remainder of the session.
 *   2. Persistent user preferences (chrome.storage.local) keyed by site:
 *        - 'always_show'    — never suppress, even after dismissals
 *        - 'hide_on_site'   — never show on this site
 *        - 'hide_everywhere' — never show on any aggregator
 *      Setting 'hide_everywhere' on any site disables pills globally.
 */

import type { AggregatorSite } from "./base"

export type CtaPref = "always_show" | "hide_on_site" | "hide_everywhere"

export type CtaPrefs = Partial<Record<AggregatorSite, CtaPref>>

const PREFS_KEY = "apex.ctaPrefs"
const DISMISSES_KEY = "apex.dismisses"
const SUPPRESSION_THRESHOLD = 3

export async function getCtaPrefs(): Promise<CtaPrefs> {
  if (!chrome.storage?.local) return {}
  const stored = await chrome.storage.local.get(PREFS_KEY)
  return (stored[PREFS_KEY] ?? {}) as CtaPrefs
}

export async function setCtaPref(site: AggregatorSite, value: CtaPref): Promise<void> {
  if (!chrome.storage?.local) return
  const prefs = await getCtaPrefs()
  prefs[site] = value
  await chrome.storage.local.set({ [PREFS_KEY]: prefs })
}

/**
 * Returns true if pills for `site` should be suppressed right now.
 * Checks (a) global hide_everywhere, (b) per-site hide_on_site, (c) per-session
 * dismiss count >= SUPPRESSION_THRESHOLD when the user hasn't pinned always_show.
 */
export async function isSuppressed(site: AggregatorSite): Promise<boolean> {
  const prefs = await getCtaPrefs()
  if (Object.values(prefs).includes("hide_everywhere")) return true
  const sitePref = prefs[site]
  if (sitePref === "hide_on_site") return true
  if (sitePref === "always_show") return false

  if (!chrome.storage?.session) return false
  const sessionStore = await chrome.storage.session.get(DISMISSES_KEY)
  const counts = (sessionStore[DISMISSES_KEY] ?? {}) as Record<string, number>
  return (counts[site] ?? 0) >= SUPPRESSION_THRESHOLD
}

/**
 * Increment the per-session dismiss counter for `site`. Returns whether the
 * site is now over the suppression threshold.
 */
export async function recordDismiss(site: AggregatorSite): Promise<{ suppressed: boolean; count: number }> {
  if (!chrome.storage?.session) return { suppressed: false, count: 0 }
  const stored = await chrome.storage.session.get(DISMISSES_KEY)
  const counts = (stored[DISMISSES_KEY] ?? {}) as Record<string, number>
  counts[site] = (counts[site] ?? 0) + 1
  await chrome.storage.session.set({ [DISMISSES_KEY]: counts })
  return { suppressed: counts[site] >= SUPPRESSION_THRESHOLD, count: counts[site] }
}

export async function clearSessionDismisses(): Promise<void> {
  if (!chrome.storage?.session) return
  await chrome.storage.session.remove(DISMISSES_KEY)
}
