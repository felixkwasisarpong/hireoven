/**
 * Data-collection consent gate (Chrome Web Store "User Data Privacy" policy).
 *
 * The content script runs on every page the user visits so it can recognize an
 * application form on ANY ats — that breadth is what the Chrome Web Store
 * review flagged as "collecting user data not closely related to the item's
 * stated functionality." The fix isn't narrowing the extension (universal
 * autofill is the point); it's gating all data collection behind an explicit,
 * in-product consent step first. Nothing in content.ts/popup.ts may read page
 * content, form fields, or profile data until hasDataConsent() is true.
 */

const CONSENT_STORAGE_KEY = "ho_data_consent_v1"

export async function hasDataConsent(): Promise<boolean> {
  const result = await chrome.storage.local.get(CONSENT_STORAGE_KEY)
  return result[CONSENT_STORAGE_KEY] === true
}

export async function grantDataConsent(): Promise<void> {
  await chrome.storage.local.set({ [CONSENT_STORAGE_KEY]: true })
}
