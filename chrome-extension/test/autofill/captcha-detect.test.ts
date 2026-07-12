import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { detectBlockingCaptcha } from "../../src/autofill/captcha-detect"

function makeVisible(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ width: 300, height: 78, top: 0, left: 0, right: 300, bottom: 78, x: 0, y: 0, toJSON() {} }) as DOMRect
  Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true })
}

beforeEach(() => { document.body.innerHTML = "" })
afterEach(() => { document.body.innerHTML = "" })

describe("detectBlockingCaptcha", () => {
  it("returns false on a clean page", () => {
    document.body.innerHTML = `<form><input name="email"><button>Submit</button></form>`
    expect(detectBlockingCaptcha(document)).toBe(false)
  })

  it("pauses on a visible, unsolved hCaptcha", () => {
    document.body.innerHTML = `
      <div class="h-captcha"><iframe src="https://newassets.hcaptcha.com/captcha/v1"></iframe></div>
      <textarea name="h-captcha-response"></textarea>`
    makeVisible(document.querySelector(".h-captcha iframe") as HTMLElement)
    expect(detectBlockingCaptcha(document)).toBe(true)
  })

  it("does NOT pause once the hCaptcha is solved (token filled)", () => {
    document.body.innerHTML = `
      <div class="h-captcha"><iframe src="https://newassets.hcaptcha.com/captcha/v1"></iframe></div>
      <textarea name="h-captcha-response">P0_eyJ...solved-token</textarea>`
    makeVisible(document.querySelector(".h-captcha iframe") as HTMLElement)
    expect(detectBlockingCaptcha(document)).toBe(false)
  })

  it("pauses on a visible, unsolved reCAPTCHA v2 checkbox", () => {
    document.body.innerHTML = `
      <div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=KEY"></iframe></div>
      <textarea id="g-recaptcha-response"></textarea>`
    makeVisible(document.querySelector(".g-recaptcha iframe") as HTMLElement)
    expect(detectBlockingCaptcha(document)).toBe(true)
  })

  it("does NOT deadlock on invisible reCAPTCHA v3 (badge, no interaction)", () => {
    document.body.innerHTML = `
      <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=KEY&size=invisible"></iframe></div>`
    makeVisible(document.querySelector(".grecaptcha-badge iframe") as HTMLElement)
    expect(detectBlockingCaptcha(document)).toBe(false)
  })

  it("does NOT pause on an unrendered/hidden widget", () => {
    document.body.innerHTML = `
      <div class="h-captcha"><iframe src="https://newassets.hcaptcha.com/captcha/v1"></iframe></div>
      <textarea name="h-captcha-response"></textarea>`
    expect(detectBlockingCaptcha(document)).toBe(false)
  })

  it("does NOT pause on an auto-passed Turnstile (token present)", () => {
    document.body.innerHTML = `
      <div class="cf-turnstile"><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge"></iframe></div>
      <input name="cf-turnstile-response" value="auto-passed-token">`
    makeVisible(document.querySelector(".cf-turnstile iframe") as HTMLElement)
    expect(detectBlockingCaptcha(document)).toBe(false)
  })
})
