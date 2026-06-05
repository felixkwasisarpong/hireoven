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
})
