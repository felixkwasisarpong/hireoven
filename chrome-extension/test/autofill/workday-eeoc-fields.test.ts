import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runWorkdayAutofillInExistingBar } from "../../src/autofill/workday-autofill"
import type { SafeProfile } from "../../src/autofill/safe-fields"
import { setLocation } from "../setup"

const profile: SafeProfile = {
  first_name: "Felix",
  last_name: "Sarpong",
  email: "felix@example.com",
  phone: "555-123-4567",
  city: "Austin",
  state: "TX",
  country: "United States",
  authorized_to_work: true,
  requires_sponsorship: false,
}

function visibleLayout() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 240,
    bottom: 32,
    width: 240,
    height: 32,
    toJSON() {
      return {}
    },
  } as DOMRect
}

function attachWorkdayPopup(combo: HTMLElement, options: string[]) {
  combo.addEventListener("click", () => {
    document.querySelector("#workday-test-menu")?.remove()
    const menu = document.createElement("div")
    menu.id = "workday-test-menu"
    menu.setAttribute("data-automation-activepopup", "true")
    menu.innerHTML = options.map((option, index) => `<div role="option" id="option-${index}">${option}</div>`).join("")
    menu.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
      option.addEventListener("click", () => {
        combo.textContent = option.textContent
      })
    })
    document.body.appendChild(menu)
  })
}

describe("Workday EEO/manual autofill fields", () => {
  beforeEach(() => {
    setLocation("https://cat.wd5.myworkdayjobs.com/CaterpillarCareers/job/apply")
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(visibleLayout)
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn()
    }
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("checks a required terms and conditions consent checkbox", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-termsConsent">
          <label for="terms">Yes, I have read and consent to the terms and conditions. *</label>
          <span><input id="terms" type="checkbox" style="opacity:0" /></span>
        </div>
      </div>
    `

    await runWorkdayAutofillInExistingBar({ profile })

    expect(document.querySelector<HTMLInputElement>("#terms")?.checked).toBe(true)
  })

  it("declines a Workday disability checkbox group when diversity autofill is not opted in", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowSelfIdentifyPage">
        <fieldset data-automation-id="formField-disabilityStatus">
          <legend>Please check one of the boxes below: *</legend>
          <label><input type="checkbox" name="disability" style="opacity:0" /> Yes, I have a disability, or have had one in the past</label>
          <label><input type="checkbox" name="disability" style="opacity:0" /> No, I do not have a disability and have not had one in the past</label>
          <label><input id="decline-disability" type="checkbox" name="disability" style="opacity:0" /> I do not want to answer</label>
        </fieldset>
      </div>
    `

    await runWorkdayAutofillInExistingBar({ profile })

    expect(document.querySelector<HTMLInputElement>("#decline-disability")?.checked).toBe(true)
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[name="disability"]')).filter((input) => input.checked)).toHaveLength(1)
  })

  it("declines a Workday veterans status combobox on application questions", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-veteranStatus">
          <label>Veterans Status:</label>
          <button id="veterans-status" type="button" role="combobox" aria-haspopup="listbox">Select One</button>
        </div>
      </div>
    `

    const combo = document.querySelector<HTMLButtonElement>("#veterans-status")!
    combo.addEventListener("click", () => {
      document.querySelector("#veterans-menu")?.remove()
      const menu = document.createElement("div")
      menu.id = "veterans-menu"
      menu.setAttribute("data-automation-activepopup", "true")
      menu.innerHTML = `
        <div role="option">I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE</div>
        <div role="option">I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN</div>
        <div role="option">I AM NOT A VETERAN</div>
        <div role="option" id="decline-veteran">I DO NOT WISH TO SELF-IDENTIFY</div>
      `
      menu.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
        option.addEventListener("click", () => {
          combo.textContent = option.textContent
        })
      })
      document.body.appendChild(menu)
    })

    await runWorkdayAutofillInExistingBar({ profile })

    expect(combo.textContent).toContain("I DO NOT WISH TO SELF-IDENTIFY")
  })

  it("answers a Workday work authorization combobox from the saved profile", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-workAuthorization">
          <label>Are you legally authorized to work in the country where the position is located?</label>
          <button id="work-authorization" type="button" role="combobox" aria-haspopup="listbox">Select One</button>
        </div>
      </div>
    `

    const combo = document.querySelector<HTMLButtonElement>("#work-authorization")!
    attachWorkdayPopup(combo, ["Yes", "No"])

    await runWorkdayAutofillInExistingBar({ profile })

    expect(combo.textContent).toBe("Yes")
  })

  it("answers a current Workday sponsorship combobox from the saved profile", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-sponsorship">
          <label>Do you now require immigration sponsorship to work in the country where this position is located?</label>
          <button id="sponsorship" type="button" role="combobox" aria-haspopup="listbox">Select One</button>
        </div>
      </div>
    `

    const combo = document.querySelector<HTMLButtonElement>("#sponsorship")!
    attachWorkdayPopup(combo, ["Yes", "No"])

    await runWorkdayAutofillInExistingBar({ profile })

    expect(combo.textContent).toBe("No")
  })

  it("answers a future Workday sponsorship combobox from the saved profile", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-futureSponsorship">
          <label>Will you in the future require immigration sponsorship to work in the country where this position is located (for example, H-1B visa, TN visa, E-3 visa)?</label>
          <button id="future-sponsorship" type="button" role="combobox" aria-haspopup="listbox">Select One</button>
        </div>
      </div>
    `

    const combo = document.querySelector<HTMLButtonElement>("#future-sponsorship")!
    attachWorkdayPopup(combo, ["Yes", "No"])

    await runWorkdayAutofillInExistingBar({ profile })

    expect(combo.textContent).toBe("No")
  })

  it("keeps citizenship questions manual even when work authorization is saved", async () => {
    document.body.innerHTML = `
      <div data-automation-id="applyFlowApplicationQuestionsPage">
        <div data-automation-id="formField-citizenship">
          <label>Are you a citizen of the United States?</label>
          <button id="citizenship" type="button" role="combobox" aria-haspopup="listbox">Select One</button>
        </div>
      </div>
    `

    const combo = document.querySelector<HTMLButtonElement>("#citizenship")!
    attachWorkdayPopup(combo, ["Yes", "No"])

    await runWorkdayAutofillInExistingBar({ profile })

    expect(combo.textContent).toBe("Select One")
  })
})
