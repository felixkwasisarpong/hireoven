// @vitest-environment jsdom
/**
 * Regression: SmartRecruiters oneclick-ui renders every control inside open
 * shadow roots (spl-* web components). Shadow-blind collection saw "no form"
 * and autofill detected nothing. These tests build an spl-like fixture with
 * real attachShadow calls.
 */
import { describe, expect, it } from "vitest"
import { applySafeFills, buildAutofillPreview } from "../../src/autofill/safe-fields"
import { queryAllDeep, queryShadowSelector } from "../../src/autofill/shadow-dom"
import type { SafeProfile } from "../../src/autofill/safe-fields"

function splInput(id: string, label: string, autocomplete: string, type = "text"): HTMLElement {
  const host = document.createElement("spl-input")
  host.setAttribute("label", label)
  host.setAttribute("autocomplete", autocomplete)
  host.id = id
  const root = host.attachShadow({ mode: "open" })
  const input = document.createElement("input")
  input.type = type
  input.id = id
  input.setAttribute("autocomplete", autocomplete)
  root.appendChild(input)
  return host
}

function build(): void {
  document.body.innerHTML = ""
  const form = document.createElement("div")
  for (const [id, label, ac] of [
    ["first-name-input", "First name", "given-name"],
    ["last-name-input", "Last name", "family-name"],
    ["email-input", "Email", "email"],
  ] as const) {
    const field = document.createElement("oc-input")
    field.appendChild(splInput(id, label, ac))
    form.appendChild(field)
  }
  document.body.appendChild(form)
}

const profile: SafeProfile = { first_name: "Felix", last_name: "Sarpong", email: "f@x.com" }

describe("shadow DOM (SmartRecruiters oneclick-ui)", () => {
  it("queryAllDeep finds controls inside open shadow roots", () => {
    build()
    expect(document.querySelectorAll("input").length).toBe(0) // shadow-blind sees nothing
    expect(queryAllDeep(document, "input").length).toBe(3)
  })

  it("preview detects shadow fields with host-attribute labels and fill sets values", async () => {
    build()
    const preview = buildAutofillPreview("smartrecruiters", profile, document)
    const labels = preview.map((r) => r.label)
    expect(labels).toContain("First name")
    expect(labels).toContain("Email")

    const rows = await applySafeFills("smartrecruiters", profile, null, document)
    const filled = rows.filter((r) => r.filled)
    expect(filled.length).toBeGreaterThanOrEqual(3)

    const first = queryShadowSelector(document, "spl-input#first-name-input >>> input") as HTMLInputElement
    expect(first.value).toBe("Felix")
    const email = queryShadowSelector(document, "spl-input#email-input >>> input") as HTMLInputElement
    expect(email.value).toBe("f@x.com")
  })
})
