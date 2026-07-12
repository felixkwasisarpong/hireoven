/**
 * Blocking-CAPTCHA detection for the autonomous apply flow.
 *
 * We deliberately DO NOT solve CAPTCHAs — that is bot-evasion. We only detect a
 * challenge that needs the human, so the run can pause, prompt the user, and
 * resume once they clear it (mirroring the existing login-wait behaviour).
 *
 * The gate is intentionally narrow, to avoid deadlocking the run on a challenge
 * the user cannot act on. A widget only counts as "blocking" when it is:
 *   (a) rendered and visibly sized on the page, AND
 *   (b) UNSOLVED — its response-token field is still empty.
 * Passive/invisible challenges (reCAPTCHA v3's badge, an auto-passing Turnstile,
 * an already-solved widget) populate their token without interaction, so they
 * never trip this and the flow proceeds normally.
 */

function isElementVisible(el: Element | null): boolean {
  if (!el) return false
  const he = el as HTMLElement
  const rect = he.getBoundingClientRect()
  if (rect.width < 20 || rect.height < 20) return false
  const style = getComputedStyle(he)
  // Computed opacity is normalised to a numeric string ("0" when fully
  // transparent); compare the string so an unset value ("") isn't misread as 0.
  if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
    return false
  }
  return he.offsetParent !== null || style.position === "fixed"
}

/** A solved challenge writes a non-empty response token into a hidden field. */
function tokenFilled(root: ParentNode, selector: string): boolean {
  const t = root.querySelector<HTMLTextAreaElement | HTMLInputElement>(selector)
  return !!t && t.value.trim().length > 0
}

/**
 * True when a visible, interactive, still-unsolved CAPTCHA is blocking the page.
 * `root` defaults to `document`; pass a ShadowRoot to scope the check.
 */
export function detectBlockingCaptcha(root: ParentNode = document): boolean {
  // hCaptcha — visible widget iframe, no response token yet.
  const hcaptcha = root.querySelector('.h-captcha iframe, iframe[src*="hcaptcha.com"]')
  if (isElementVisible(hcaptcha) && !tokenFilled(root, 'textarea[name="h-captcha-response"], [name="h-captcha-response"]')) {
    return true
  }

  // Cloudflare Turnstile — managed/interactive widget that hasn't auto-passed.
  const turnstile = root.querySelector('.cf-turnstile iframe, iframe[src*="challenges.cloudflare.com"]')
  if (isElementVisible(turnstile) && !tokenFilled(root, '[name="cf-turnstile-response"]')) {
    return true
  }

  // reCAPTCHA v2 checkbox (anchor iframe lives under `.g-recaptcha`; v3's badge
  // lives under `.grecaptcha-badge`, so this selector excludes the invisible v3)
  // or the image-challenge popup (`bframe`), with no response token yet.
  const recaptchaAnchor = root.querySelector('.g-recaptcha iframe[src*="recaptcha"]')
  const recaptchaChallenge = root.querySelector(
    'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]',
  )
  if (
    (isElementVisible(recaptchaAnchor) || isElementVisible(recaptchaChallenge)) &&
    !tokenFilled(root, '#g-recaptcha-response, textarea[name="g-recaptcha-response"]')
  ) {
    return true
  }

  // FunCaptcha / Arkose Labs — the enforcement frame only renders when a
  // challenge is actually required.
  const funcaptcha = root.querySelector('#FunCaptcha iframe, iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]')
  if (isElementVisible(funcaptcha)) return true

  return false
}
