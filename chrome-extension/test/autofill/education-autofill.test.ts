/**
 * Regression test for education autofill on generic (non-Workday) ATS forms.
 *
 * Before: the generic safe-fields path mapped work experience but IGNORED
 * education entirely — so a form's School / Degree / Field of Study / GPA /
 * Graduation fields stayed blank on Greenhouse/Lever/Ashby/BambooHR/generic
 * forms, even though the résumé (and the autofill-profile API) carry it.
 *
 * After: dedicated school/degree/field_of_study/graduation_date/gpa keys fill
 * each input from resume_education (multi-row), falling back to the flat
 * "highest degree" profile fields for a single-entry form.
 */

import { describe, expect, it } from "vitest"
import { buildAutofillPreview, applySafeFills } from "../../src/autofill/safe-fields"

const profile = {
  first_name: "Felix",
  last_name: "Sarpong",
  resume_education: [
    {
      institution: "University of Ghana",
      degree: "BSc Computer Science",
      field: "Computer Science",
      start_date: "2016",
      end_date: "2020",
      gpa: "3.8",
    },
    {
      institution: "MIT",
      degree: "MSc",
      field: "Artificial Intelligence",
      start_date: "2021",
      end_date: "2023",
      gpa: "3.9",
    },
  ],
} as Parameters<typeof buildAutofillPreview>[1]

describe("Education autofill (generic path)", () => {
  it("fills School, Degree, Field of Study, Graduation year and GPA from the résumé", async () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="school" aria-label="School / University" type="text" value="" />
        <input id="degree" aria-label="Degree" type="text" value="" />
        <input id="major" aria-label="Field of Study" type="text" value="" />
        <input id="grad" aria-label="Graduation Year" type="text" value="" />
        <input id="gpa" aria-label="GPA" type="text" value="" />
      </form>`

    await applySafeFills("greenhouse", profile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("school")).toBe("University of Ghana")
    expect(get("degree")).toBe("BSc Computer Science")
    expect(get("major")).toBe("Computer Science")
    expect(get("grad")).toBe("2020") // bare year stays a year, not "01/2020"
    expect(get("gpa")).toBe("3.8")
  })

  it("maps 'Major' to Field of Study but not 'Major responsibilities'", () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="major" aria-label="Major" type="text" value="" />
        <textarea id="dutieslabel" aria-label="Major responsibilities in your last role"></textarea>
      </form>`

    const rows = buildAutofillPreview("greenhouse", profile, document)
    const major = rows.find((r) => r.selector === "#major")
    const duties = rows.find((r) => r.selector === "#dutieslabel")
    expect(major?.valuePreview).toBe("Computer Science")
    // "Major responsibilities" must NOT be treated as a field-of-study input.
    expect(duties?.valuePreview).not.toBe("Computer Science")
  })

  it("fills successive education rows when the form repeats School/Degree", async () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="school1" aria-label="School" type="text" value="" />
        <input id="degree1" aria-label="Degree" type="text" value="" />
        <input id="school2" aria-label="School" type="text" value="" />
        <input id="degree2" aria-label="Degree" type="text" value="" />
      </form>`

    await applySafeFills("greenhouse", profile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("school1")).toBe("University of Ghana")
    expect(get("school2")).toBe("MIT")
    expect(get("degree1")).toBe("BSc Computer Science")
    expect(get("degree2")).toBe("MSc")
  })

  it("falls back to the flat highest-degree fields when no education list is sent", async () => {
    const flatProfile = {
      first_name: "Felix",
      university: "Stanford University",
      highest_degree: "PhD",
      field_of_study: "Robotics",
      graduation_year: 2019,
      gpa: "4.0",
    } as Parameters<typeof buildAutofillPreview>[1]

    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="school" aria-label="University" type="text" value="" />
        <input id="degree" aria-label="Highest Degree" type="text" value="" />
        <input id="major" aria-label="Field of Study" type="text" value="" />
        <input id="grad" aria-label="Graduation Year" type="text" value="" />
        <input id="gpa" aria-label="GPA" type="text" value="" />
      </form>`

    await applySafeFills("generic", flatProfile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("school")).toBe("Stanford University")
    expect(get("degree")).toBe("PhD")
    expect(get("major")).toBe("Robotics")
    expect(get("grad")).toBe("2019")
    expect(get("gpa")).toBe("4.0")
  })
})
