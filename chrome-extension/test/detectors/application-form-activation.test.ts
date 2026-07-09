// @vitest-environment jsdom
/**
 * The Apex bar now activates on ANY page with a fillable application form, not
 * just recognized ATS hosts / career URLs (content-based activation). These
 * tests pin the gate predicate `isFillableApplicationForm` so it fires on real
 * application forms but stays quiet on login / newsletter / bare contact forms.
 * (jsdom's host is localhost → detectSite() === "unknown", the generic path.)
 */
import { describe, expect, it } from "vitest"
import { isFillableApplicationForm } from "../../src/detectors/application-form"

describe("isFillableApplicationForm (content-based activation gate)", () => {
  it("fires on a generic application form (name/email/phone + résumé upload) on an unknown host", () => {
    document.body.innerHTML = `
      <form>
        <label>First Name <input type="text" name="first_name" /></label>
        <label>Last Name <input type="text" name="last_name" /></label>
        <label>Email <input type="email" name="email" /></label>
        <label>Phone <input type="tel" name="phone" /></label>
        <label>Resume <input type="file" name="resume" accept=".pdf,.doc" /></label>
      </form>`
    expect(isFillableApplicationForm(document)).toBe(true)
  })

  it("fires on a form hinted by class with ≥3 profile fields (no file upload)", () => {
    document.body.innerHTML = `
      <form class="application-form">
        <label>Full Name <input type="text" name="full_name" /></label>
        <label>Email <input type="email" name="email" /></label>
        <label>Phone <input type="tel" name="phone" /></label>
      </form>`
    expect(isFillableApplicationForm(document)).toBe(true)
  })

  it("stays quiet on a login form (email + password)", () => {
    document.body.innerHTML = `
      <form id="login">
        <label>Email <input type="email" name="email" /></label>
        <label>Password <input type="password" name="password" /></label>
        <button type="submit">Sign in</button>
      </form>`
    expect(isFillableApplicationForm(document)).toBe(false)
  })

  it("stays quiet on a newsletter signup (single email)", () => {
    document.body.innerHTML = `
      <form>
        <label>Subscribe <input type="email" name="email" /></label>
        <button type="submit">Subscribe</button>
      </form>`
    expect(isFillableApplicationForm(document)).toBe(false)
  })

  it("stays quiet on a bare 2-field contact form (no résumé, no hint)", () => {
    document.body.innerHTML = `
      <form>
        <label>Name <input type="text" name="name" /></label>
        <label>Email <input type="email" name="email" /></label>
        <label>Message <textarea name="message"></textarea></label>
      </form>`
    expect(isFillableApplicationForm(document)).toBe(false)
  })
})
