import { beforeEach, describe, expect, it } from "vitest"
import {
  fillAshbyRequiredFields,
  fillRequiredAtsFields,
  findAshbyResumeParserInput,
} from "../../src/autofill/ashby-autofill"
import { pickResumeFileInput } from "../../src/autofill/resume-target"
import type { SafeProfile } from "../../src/autofill/safe-fields"

const profile: SafeProfile = {
  first_name: "FELIX",
  last_name: "SARPONG",
  email: "felix@example.com",
  phone: "555-123-4567",
  city: "Austin",
  state: "TX",
  country: "United States",
  authorized_to_work: true,
  requires_sponsorship: false,
  current_company: "Acme Analytics",
  work_experience: [
    { company: "Acme Analytics", title: "Data Analyst", is_current: true },
    { company: "Northwind Labs", title: "Analyst", is_current: false },
  ],
}

const ASHBY_RESUME_HTML = `
  <main>
    <div class="autofill-banner">
      <p>Autofill from resume</p>
      <p>Upload your resume here to autofill key application fields.</p>
      <input id="parser-upload" type="file" accept=".pdf,.doc,.docx" />
    </div>
    <form class="_ashby-application-form">
      <div class="_fieldEntry_x">
        <label>Resume <span aria-hidden="true">*</span></label>
        <input id="resume-field" type="file" accept=".pdf,.doc,.docx" required />
      </div>
    </form>
  </main>`

const ASHBY_REQUIRED_HTML = `
  <form class="_ashby-application-form">
    <div class="_fieldEntry_x">
      <label>Name <span>*</span></label>
      <input id="_systemfield_name" type="text" value="" />
    </div>
    <div class="_fieldEntry_x">
      <label>Email <span>*</span></label>
      <input id="_systemfield_email" type="email" value="" />
    </div>
    <div class="_fieldEntry_x">
      <label>Phone Number <span>*</span></label>
      <input id="_systemfield_phone" type="tel" value="" />
    </div>
    <div class="_fieldEntry_x">
      <label>Location <span>*</span></label>
      <input id="_systemfield_location" type="text" value="" />
    </div>
    <div class="_fieldEntry_x">
      <label>Where have you most recently worked? <span>*</span></label>
      <input id="current-company" type="text" value="" />
    </div>
    <div class="_fieldEntry_x">
      <label>Will you require company sponsorship now or in the future to maintain or extend your current work authorization status? <span>*</span></label>
      <label><input id="sponsor-yes" name="sponsor" type="radio" value="Yes" /> Yes</label>
      <label><input id="sponsor-no" name="sponsor" type="radio" value="No" /> No</label>
    </div>
    <div class="_fieldEntry_x">
      <label>For Snowflake to anticipate possible immigration timelines and obligations, could you confirm you are currently authorized to work in the country to which you are applying? <span>*</span></label>
      <label><input id="auth-yes" name="authorized" type="radio" value="Yes" /> Yes</label>
      <label><input id="auth-no" name="authorized" type="radio" value="No" /> No</label>
    </div>
    <div class="_fieldEntry_x">
      <label>Have you worked at Snowflake in the past in a full-time, part-time, contractor or intern capacity? <span>*</span></label>
      <label><input id="snowflake-yes" name="snowflake" type="radio" value="Yes" /> Yes</label>
      <label><input id="snowflake-no" name="snowflake" type="radio" value="No" /> No</label>
    </div>
    <div class="_fieldEntry_x">
      <label>Due to SEC auditor independence requirements, please let us know whether you have previously worked at PricewaterhouseCoopers (PWC), who is our independent auditor. <span>*</span></label>
      <label><input id="pwc-yes" name="pwc" type="radio" value="Yes" /> Yes</label>
      <label><input id="pwc-no" name="pwc" type="radio" value="No" /> No</label>
    </div>
    <div class="_fieldEntry_x">
      <label>In any materials you submit, you may redact or remove age-identifying information such as age, date of birth, or dates of school attendance or graduation. <span>*</span></label>
      <input id="redaction" type="checkbox" />
    </div>
    <div class="_fieldEntry_x">
      <label>Snowflake will process your personal information in accordance with the Snowflake Candidate Privacy Notice. <span>*</span></label>
      <input id="privacy" type="checkbox" />
    </div>
  </form>`

describe("Ashby autofill helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("can target Ashby's parser banner without changing normal resume submission targeting", () => {
    document.body.innerHTML = ASHBY_RESUME_HTML

    expect(findAshbyResumeParserInput(document)?.id).toBe("parser-upload")
    expect(pickResumeFileInput(document)?.id).toBe("resume-field")
  })

  it("does not treat the real Resume field as Ashby's parser when the parser banner is absent", () => {
    document.body.innerHTML = `
      <form class="_ashby-application-form">
        <div class="_fieldEntry_x">
          <label>Resume <span aria-hidden="true">*</span></label>
          <input id="resume-field" type="file" accept=".pdf,.doc,.docx" required />
        </div>
      </form>`

    expect(findAshbyResumeParserInput(document)).toBeNull()
    expect(pickResumeFileInput(document)?.id).toBe("resume-field")
  })

  it("fills Snowflake-style required Ashby fields from explicit profile values", async () => {
    document.body.innerHTML = ASHBY_REQUIRED_HTML

    const summary = await fillAshbyRequiredFields({ profile, doc: document })
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
    const checked = (id: string) => (document.getElementById(id) as HTMLInputElement).checked

    expect(value("_systemfield_name")).toBe("Felix Sarpong")
    expect(value("_systemfield_email")).toBe("felix@example.com")
    expect(value("_systemfield_phone")).toBe("555-123-4567")
    expect(value("_systemfield_location")).toBe("Austin, TX, United States")
    expect(value("current-company")).toBe("Acme Analytics")
    expect(checked("sponsor-no")).toBe(true)
    expect(checked("auth-yes")).toBe(true)
    expect(checked("snowflake-no")).toBe(true)
    expect(checked("pwc-no")).toBe(true)
    expect(checked("redaction")).toBe(true)
    expect(checked("privacy")).toBe(true)
    expect(summary.filledCount).toBeGreaterThanOrEqual(11)
    expect(summary.manualReviewCount).toBe(0)
  })

  it("uses the semantic matcher for required custom text fields on non-Ashby ATS forms", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <div class="application-question">
          <label for="why">Why are you interested in this role? <span>*</span></label>
          <textarea id="why" required></textarea>
        </div>
      </form>`

    const summary = await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async (questions) => {
        expect(questions).toHaveLength(1)
        expect(questions[0].type).toBe("textarea")
        return [
          {
            id: questions[0].id,
            value: "I am interested because the role aligns with my analytics experience and lets me contribute quickly.",
            confidence: "high",
          },
        ]
      },
    })

    expect((document.getElementById("why") as HTMLTextAreaElement).value).toContain("analytics experience")
    expect(summary.filledCount).toBe(1)
    expect(summary.manualReviewCount).toBe(0)
  })

  it("does not send sensitive required prompts to the semantic matcher", async () => {
    let matcherCalled = false
    document.body.innerHTML = `
      <form class="application-form">
        <div class="application-question">
          <label for="gender">Gender <span>*</span></label>
          <input id="gender" required />
        </div>
      </form>`

    const summary = await fillRequiredAtsFields({
      profile,
      doc: document,
      matchQuestions: async () => {
        matcherCalled = true
        return []
      },
    })

    expect(matcherCalled).toBe(false)
    expect((document.getElementById("gender") as HTMLInputElement).value).toBe("")
    expect(summary.filledCount).toBe(0)
  })

  // Wire a jsdom stand-in for a react-select combobox: opening (mousedown/click)
  // renders an options menu; clicking an option drops a singleValue chip and
  // clears the search input — mirroring how the real widget commits a choice.
  function wireReactSelect(rowId: string, optionLabels: string[]): void {
    const row = document.getElementById(rowId)!
    const input = row.querySelector<HTMLInputElement>("input.select__input")!
    const open = () => {
      if (row.querySelector(".select__menu")) return
      const menu = document.createElement("div")
      menu.className = "select__menu"
      for (const label of optionLabels) {
        const opt = document.createElement("div")
        opt.className = "select__option"
        opt.setAttribute("role", "option")
        opt.textContent = label
        opt.addEventListener("click", () => {
          const chip = document.createElement("div")
          chip.className = "select__single-value"
          chip.textContent = label
          row.querySelector(".select__control")!.prepend(chip)
          input.value = ""
          menu.remove()
        })
        menu.appendChild(opt)
      }
      row.appendChild(menu)
    }
    input.addEventListener("mousedown", open)
    input.addEventListener("click", open)
  }

  const chipText = (rowId: string) =>
    document.getElementById(rowId)!.querySelector(".select__single-value")?.textContent ?? ""

  it("selects react-select combobox options for Country and Yes/No work-auth dropdowns", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <div id="country-row" class="application-question">
          <label>Country <span>*</span></label>
          <div class="select__control">
            <input class="select__input" role="combobox" aria-autocomplete="list" type="text" />
          </div>
        </div>
        <div id="sponsor-row" class="application-question">
          <label>Will you now or in the future require sponsorship for employment visa status? <span>*</span></label>
          <div class="select__control">
            <input class="select__input" role="combobox" aria-autocomplete="list" type="text" />
          </div>
        </div>
      </form>`

    wireReactSelect("country-row", ["Canada", "United Kingdom", "United States", "Germany"])
    wireReactSelect("sponsor-row", ["Yes", "No"])

    const summary = await fillRequiredAtsFields({ profile, doc: document })

    expect(chipText("country-row")).toBe("United States")
    expect(chipText("sponsor-row")).toBe("No") // requires_sponsorship: false
    expect(summary.filledCount).toBeGreaterThanOrEqual(2)
  })

  it("maps a US-variant profile country onto the ATS's 'United States' option", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <div id="country-row" class="application-question">
          <label>Country <span>*</span></label>
          <div class="select__control">
            <input class="select__input" role="combobox" aria-autocomplete="list" type="text" />
          </div>
        </div>
      </form>`

    wireReactSelect("country-row", ["United Kingdom", "United States", "Australia"])

    await fillRequiredAtsFields({ profile: { ...profile, country: "USA" }, doc: document })

    expect(chipText("country-row")).toBe("United States")
  })

  it("answers 'No' to sponsorship for a work-authorized applicant even when a future-sponsorship flag is set", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <fieldset class="application-question">
          <legend>Will you require sponsorship for employment now or in the future? <span>*</span></legend>
          <label><input type="radio" name="sponsor" value="yes" /> Yes</label>
          <label><input type="radio" name="sponsor" value="no" /> No</label>
        </fieldset>
      </form>`

    // authorized_to_work: true but requires_sponsorship intentionally true —
    // the authorized-to-work rule must still answer No.
    await fillRequiredAtsFields({
      profile: { ...profile, authorized_to_work: true, requires_sponsorship: true },
      doc: document,
    })

    const checked = document.querySelector<HTMLInputElement>('input[name="sponsor"]:checked')
    expect(checked?.value).toBe("no")
  })

  it("leaves conditional 'If yes …' follow-up fields blank instead of filling them from the profile", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <div class="application-question">
          <label for="intl">If you selected international, what location(s)?</label>
          <textarea id="intl"></textarea>
        </div>
        <div class="application-question">
          <label for="sponstype">If yes, what type of sponsorship?</label>
          <textarea id="sponstype"></textarea>
        </div>
      </form>`

    await fillRequiredAtsFields({ profile, doc: document })

    expect((document.getElementById("intl") as HTMLTextAreaElement).value).toBe("")
    expect((document.getElementById("sponstype") as HTMLTextAreaElement).value).toBe("")
  })

  it("ticks one office for a 'select all that apply' relocate checkbox group", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <fieldset class="application-question">
          <legend>What office(s) would you be willing to relocate to? (Select all that apply)</legend>
          <label><input type="checkbox" name="office" value="sd" /> San Diego, California</label>
          <label><input type="checkbox" name="office" value="dal" /> Dallas, Texas</label>
          <label><input type="checkbox" name="office" value="dc" /> Washington, DC</label>
        </fieldset>
      </form>`

    await fillRequiredAtsFields({ profile: { ...profile, willing_to_relocate: true }, doc: document })

    const checked = document.querySelectorAll<HTMLInputElement>('input[name="office"]:checked')
    expect(checked.length).toBe(1)
  })

  it("defaults 'Are you a transitioning service member?' to No for a non-veteran profile", async () => {
    document.body.innerHTML = `
      <form class="application-form">
        <fieldset class="application-question">
          <legend>Are you a transitioning service member? <span>*</span></legend>
          <label><input type="radio" name="tsm" value="no" /> No</label>
          <label><input type="radio" name="tsm" value="yes" /> Yes</label>
        </fieldset>
      </form>`

    await fillRequiredAtsFields({ profile, doc: document })

    const checked = document.querySelector<HTMLInputElement>('input[name="tsm"]:checked')
    expect(checked?.value).toBe("no")
  })

  it("answers an Ashby Yes/No BUTTON group (work auth) and counts it as answered via the _active class", async () => {
    // Real Baseten/Ashby markup: the Yes/No answer is a pair of <button>s whose
    // SELECTED state is a class ("_active_*"), not aria — plus a hidden checkbox.
    // isQuestionAnswered must recognise the class, else the filled field is
    // reported as needing manual review (and re-clicked → toggled off) on rescan.
    document.body.innerHTML = `
      <form class="_ashby-application-form">
        <div class="_fieldEntry_x">
          <label class="_required">Do you currently have unrestricted work authorization in the United States? <span>*</span></label>
          <div class="_container _yesno">
            <button type="button" class="_option">Yes</button>
            <button type="button" class="_option">No</button>
            <input class="_input" type="checkbox" tabindex="-1" />
          </div>
        </div>
      </form>`
    // Simulate Ashby's React behavior: clicking an option marks it _active
    // (clearing its sibling) and toggles the hidden checkbox.
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("._yesno button")]
    const cb = document.querySelector<HTMLInputElement>("._yesno ._input")!
    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        for (const b of buttons) b.className = "_option"
        btn.className = "_option _active_1svni_57"
        cb.checked = /yes/i.test(btn.textContent ?? "")
      })
    }

    const summary = await fillRequiredAtsFields({
      profile: { first_name: "Felix", email: "f@x.com", authorized_to_work: true },
      doc: document,
    })

    // Authorized applicant → "Yes" selected, and the field is NOT left for manual review.
    expect(buttons.find((b) => /yes/i.test(b.textContent ?? ""))!.className).toMatch(/_active/)
    expect(cb.checked).toBe(true)
    expect(summary.manualReviewCount).toBe(0)
  })

  it("selects a React-controlled EEO radio via a real click, so its state registers (not just .checked)", async () => {
    // Ashby's EEO radios are React-CONTROLLED: the selected state is driven by the
    // CLICK event, not input.checked. Setting .checked + dispatching 'change' left
    // React unaware → the radio reverted on re-render and the form SUBMITTED EMPTY
    // (gender/race/veteran "not filling"). setReactChecked must click.
    document.body.innerHTML = `
      <form class="_ashby-application-form">
        <fieldset class="_fieldEntry">
          <label class="_label">Gender</label>
          <label for="g0">Male</label><input id="g0" type="radio" name="gender" />
          <label for="g1">Female</label><input id="g1" type="radio" name="gender" />
          <label for="g2">Decline to self-identify</label><input id="g2" type="radio" name="gender" />
        </fieldset>
      </form>`
    // React state is updated ONLY by the click event (a bare .checked set is invisible to it).
    const reactState: Record<string, boolean> = { g0: false, g1: false, g2: false }
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="gender"]')) {
      r.addEventListener("click", () => {
        for (const k of Object.keys(reactState)) reactState[k] = false
        reactState[r.id] = true
      })
    }

    await fillRequiredAtsFields({
      profile: { first_name: "Felix", email: "f@x.com", auto_fill_diversity: true, gender: "Male" },
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })

    expect(reactState.g0).toBe(true) // React (click-driven) state registered — would be false on a .checked-only path
    expect(document.querySelector<HTMLInputElement>("#g0")!.checked).toBe(true)
  })

  it("writes a PLAIN answer into a free-TEXT 'how did you hear' field, not the raw SOURCE_CANDIDATES sentinel", async () => {
    // "How did you hear about this job?" is answered with a candidate-list sentinel
    // (meant for dropdowns). On Greenhouse it renders as a free-text input — the
    // text branch must unwrap the sentinel, else "__ho_source__Calendly career
    // site|…" leaks into the box.
    document.body.innerHTML = `
      <form class="_ashby-application-form">
        <div class="_fieldEntry_x">
          <label>How did you hear about this job? <span>*</span></label>
          <input id="hear" type="text" required value="" />
        </div>
      </form>`
    await fillRequiredAtsFields({
      profile: { first_name: "Felix", email: "f@x.com" },
      doc: document,
      matchQuestions: async (qs) => qs.map((q) => ({ id: q.id, value: null, confidence: "low" as const })),
    })
    const v = document.querySelector<HTMLInputElement>("#hear")!.value
    expect(v).not.toContain("__ho_source__")
    expect(v.length).toBeGreaterThan(0)
  })
})
