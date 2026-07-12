import { describe, it, expect, beforeEach } from "vitest"
import { removeExistingResumeAttachment } from "../../src/autofill/resume-target"

beforeEach(() => { document.body.innerHTML = "" })

// Assert the given control gets clicked (and nothing else fires).
function trackClicks(): string[] {
  const clicked: string[] = []
  document.querySelectorAll<HTMLElement>("button, a, [role=button]").forEach((el) => {
    el.addEventListener("click", () => clicked.push(el.getAttribute("data-id") ?? el.textContent ?? "?"))
  })
  return clicked
}

describe("removeExistingResumeAttachment — varied controls", () => {
  const wrap = (inner: string) =>
    `<div class="file-attachment"><span>Resume — Jane_Doe_Resume.pdf</span>${inner}</div>`

  it("clicks a Remove button", () => {
    document.body.innerHTML = wrap(`<button data-id="rm">Remove</button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["rm"])
  })

  it("clicks a Replace button (not just remove)", () => {
    document.body.innerHTML = wrap(`<button data-id="rep">Replace</button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["rep"])
  })

  it("clicks a Change file button", () => {
    document.body.innerHTML = wrap(`<button data-id="chg">Change file</button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["chg"])
  })

  it("clicks an × / trash icon control", () => {
    document.body.innerHTML = wrap(`<button data-id="x" aria-label="">×</button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["x"])
  })

  it("trusts the row's sole control even if unlabelled", () => {
    document.body.innerHTML = wrap(`<button data-id="only"><svg></svg></button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["only"])
  })

  it("prefers the clear control over a download control", () => {
    document.body.innerHTML = wrap(`<a href="/dl" data-id="dl">Download</a><button data-id="rm">Remove</button>`)
    const c = trackClicks()
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(c).toEqual(["rm"])
  })

  it("does NOT click a control that opens a native file dialog (label/for)", () => {
    document.body.innerHTML = wrap(`<label data-id="lbl" for="f">Replace</label><input id="f" type="file">`)
    const c = trackClicks()
    // Only a native-picker control exists → must not click it (would deadlock).
    expect(removeExistingResumeAttachment(document)).toBe(false)
    expect(c).toEqual([])
  })

  it("ignores a fresh form with no attachment", () => {
    document.body.innerHTML = `<section><h3>Resume</h3><input type="file"></section>`
    expect(removeExistingResumeAttachment(document)).toBe(false)
  })

  it("ignores an unrelated cover-letter remove", () => {
    document.body.innerHTML = `<div class="file-attachment"><span>Cover_Letter.pdf</span><button>Remove</button></div>`
    expect(removeExistingResumeAttachment(document)).toBe(false)
  })
})
