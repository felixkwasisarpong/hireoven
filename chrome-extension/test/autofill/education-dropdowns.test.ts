/**
 * Regression test for the Greenhouse-style Education block, where School /
 * Degree / Discipline / date-month are react-select DROPDOWNS (not text inputs)
 * and year is a text input. safe-fields skips comboboxes, so these never filled
 * even though `resume_education` carries every value. fillEducationDropdowns
 * drives them via the shared combobox driver, one résumé row per on-page block.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { fillEducationDropdowns } from "../../src/autofill/ashby-autofill"
import type { SafeProfile } from "../../src/autofill/safe-fields"

const profile: SafeProfile = {
  first_name: "Felix",
  last_name: "Sarpong",
  resume_education: [
    {
      institution: "University of Ghana",
      degree: "BSc Computer Science",
      field: "Computer Science",
      start_date: "2016-09",
      end_date: "2020-06",
      gpa: "3.8",
    },
    {
      institution: "MIT",
      degree: "MSc Artificial Intelligence",
      field: "Artificial Intelligence",
      start_date: "2021",
      end_date: "2023",
      gpa: "3.9",
    },
  ],
}

// A react-select stand-in: opening (mousedown/click on the input OR the control)
// renders an options menu; clicking an option drops a chip and clears the input.
function wireSelect(rowId: string, optionLabels: string[]): void {
  const row = document.getElementById(rowId)!
  const input = row.querySelector<HTMLInputElement>("input.select__input")!
  const control = row.querySelector<HTMLElement>(".select__control")!
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
        control.prepend(chip)
        input.value = ""
        menu.remove()
      })
      menu.appendChild(opt)
    }
    row.appendChild(menu)
  }
  input.addEventListener("mousedown", open)
  input.addEventListener("click", open)
  control.addEventListener("mousedown", open)
  control.addEventListener("click", open)
}

const chip = (rowId: string) =>
  document.getElementById(rowId)!.querySelector(".select__single-value")?.textContent ?? ""

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function eduBlock(suffix: string): string {
  return `
    <div id="school${suffix}" class="application-question">
      <label>School</label>
      <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
    </div>
    <div id="degree${suffix}" class="application-question">
      <label>Degree</label>
      <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
    </div>
    <div id="discipline${suffix}" class="application-question">
      <label>Discipline</label>
      <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
    </div>
    <div id="startmonth${suffix}" class="application-question">
      <label>Start date month</label>
      <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
    </div>
    <div id="startyear${suffix}" class="application-question">
      <label>Start date year</label>
      <input id="startyear-input${suffix}" type="text" value="" />
    </div>
    <div id="endmonth${suffix}" class="application-question">
      <label>End date month</label>
      <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
    </div>
    <div id="endyear${suffix}" class="application-question">
      <label>End date year</label>
      <input id="endyear-input${suffix}" type="text" value="" />
    </div>`
}

describe("Education dropdown autofill", () => {
  beforeEach(() => {
    document.body.innerHTML = `<form class="application-form"><h3>Education</h3>${eduBlock("1")}</form>`
    wireSelect("school1", ["Stanford University", "University of Ghana", "MIT"])
    wireSelect("degree1", ["High School Diploma", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Doctorate (PhD)"])
    wireSelect("discipline1", ["Biology", "Computer Science", "Economics", "Artificial Intelligence"])
    wireSelect("startmonth1", MONTHS)
    wireSelect("endmonth1", MONTHS)
  })

  it("fills School (typeahead), Degree (mapped), Discipline, months and year text", async () => {
    const filled = await fillEducationDropdowns(profile, document)

    expect(chip("school1")).toBe("University of Ghana")
    expect(chip("degree1")).toBe("Bachelor's Degree") // mapped from "BSc Computer Science"
    expect(chip("discipline1")).toBe("Computer Science")
    expect(chip("startmonth1")).toBe("September")
    expect(chip("endmonth1")).toBe("June")
    expect((document.getElementById("startyear-input1") as HTMLInputElement).value).toBe("2016")
    expect((document.getElementById("endyear-input1") as HTMLInputElement).value).toBe("2020")
    expect(filled).toBeGreaterThanOrEqual(7)
  })

  it("maps each résumé entry to its own block across 'Add another'", async () => {
    document.body.innerHTML = `<form class="application-form"><h3>Education</h3>${eduBlock("1")}${eduBlock("2")}</form>`
    wireSelect("school1", ["Stanford University", "University of Ghana", "MIT"])
    wireSelect("degree1", ["Bachelor's Degree", "Master's Degree"])
    wireSelect("discipline1", ["Computer Science", "Artificial Intelligence"])
    wireSelect("startmonth1", MONTHS)
    wireSelect("endmonth1", MONTHS)
    wireSelect("school2", ["Stanford University", "University of Ghana", "MIT"])
    wireSelect("degree2", ["Bachelor's Degree", "Master's Degree"])
    wireSelect("discipline2", ["Computer Science", "Artificial Intelligence"])
    wireSelect("startmonth2", MONTHS)
    wireSelect("endmonth2", MONTHS)

    await fillEducationDropdowns(profile, document)

    expect(chip("school1")).toBe("University of Ghana")
    expect(chip("degree1")).toBe("Bachelor's Degree")
    expect(chip("school2")).toBe("MIT")
    expect(chip("degree2")).toBe("Master's Degree")
    expect(chip("discipline2")).toBe("Artificial Intelligence")
  })

  it("does nothing when the résumé has no education", async () => {
    const filled = await fillEducationDropdowns({ first_name: "Felix" } as SafeProfile, document)
    expect(filled).toBe(0)
    expect(chip("school1")).toBe("")
  })

  it("fills the year even when the month dropdown and year text share one row", async () => {
    // Real Greenhouse packs "Start date month" (dropdown) + "Start date year"
    // (text) into a SINGLE field row. The year must still fill from its own label.
    document.body.innerHTML = `
      <form class="application-form"><h3>Education</h3>
        <div id="school1" class="application-question">
          <label>School</label>
          <div class="select__control"><input class="select__input" role="combobox" type="text" /></div>
        </div>
        <div id="startrow" class="application-question">
          <div class="select__control">
            <input id="sm" class="select__input" role="combobox" aria-label="Start date month" type="text" />
          </div>
          <label for="sy">Start date year</label>
          <input id="sy" type="text" value="" />
        </div>
        <div id="endrow" class="application-question">
          <div class="select__control">
            <input id="em" class="select__input" role="combobox" aria-label="End date month" type="text" />
          </div>
          <label for="ey">End date year</label>
          <input id="ey" type="text" value="" />
        </div>
      </form>`
    wireSelect("school1", ["University of Ghana", "MIT"])
    // Wire the two month dropdowns by their control rows.
    for (const [id, opts] of [["sm", MONTHS], ["em", MONTHS]] as const) {
      const input = document.getElementById(id) as HTMLInputElement
      const control = input.closest(".select__control") as HTMLElement
      const open = () => {
        if (control.querySelector(".select__menu")) return
        const menu = document.createElement("div")
        menu.className = "select__menu"
        for (const label of opts) {
          const o = document.createElement("div")
          o.className = "select__option"
          o.setAttribute("role", "option")
          o.textContent = label
          o.addEventListener("click", () => {
            const chip = document.createElement("div")
            chip.className = "select__single-value"
            chip.textContent = label
            control.prepend(chip)
            input.value = ""
            menu.remove()
          })
          menu.appendChild(o)
        }
        control.appendChild(menu)
      }
      input.addEventListener("mousedown", open)
      input.addEventListener("click", open)
      control.addEventListener("mousedown", open)
      control.addEventListener("click", open)
    }

    await fillEducationDropdowns(profile, document)
    expect((document.getElementById("sy") as HTMLInputElement).value).toBe("2016")
    expect((document.getElementById("ey") as HTMLInputElement).value).toBe("2020")
  })

  it("fills start & end year from a range packed into one date field", async () => {
    const packed: SafeProfile = {
      resume_education: [
        { institution: "University of Ghana", degree: "BSc", field: "CS", start_date: "2016 – 2020", end_date: null },
      ],
    } as SafeProfile
    document.body.innerHTML = `
      <form class="application-form"><h3>Education</h3>
        <div id="school1" class="application-question"><label>School</label>
          <div class="select__control"><input class="select__input" role="combobox" type="text" /></div></div>
        <div id="startyear" class="application-question"><label for="sy2">Start date year</label>
          <input id="sy2" type="text" value="" /></div>
        <div id="endyear" class="application-question"><label for="ey2">End date year</label>
          <input id="ey2" type="text" value="" /></div>
      </form>`
    wireSelect("school1", ["University of Ghana"])

    await fillEducationDropdowns(packed, document)
    expect((document.getElementById("sy2") as HTMLInputElement).value).toBe("2016")
    expect((document.getElementById("ey2") as HTMLInputElement).value).toBe("2020")
  })

  it("never overwrites a school the user already picked", async () => {
    // Pre-select a school chip so the field reads as answered.
    const control = document.querySelector("#school1 .select__control")!
    const preset = document.createElement("div")
    preset.className = "select__single-value"
    preset.textContent = "Harvard University"
    control.prepend(preset)

    await fillEducationDropdowns(profile, document)
    expect(chip("school1")).toBe("Harvard University")
  })
})
