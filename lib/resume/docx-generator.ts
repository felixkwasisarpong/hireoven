/**
 * Generates a DOCX resume that matches the ResumeDocumentPreview layout:
 *   - Centered header: NAME (caps, extrabold), contact row, headline
 *   - Sections: Profile · Skills · Experience · Projects · Education
 *   - Section headings: UPPERCASE bold, full-width bottom border
 *   - Experience rows: "Title | Company" (bold) + date (right-aligned)
 *   - Achievements rendered as disc bullets
 *   - Education rows: "Degree - Field | Institution" + date (right-aligned)
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
  UnderlineType,
} from "docx"
import type { Resume } from "@/types"

// ─── unit helpers ──────────────────────────────────────────────────────────────
// docx `size` is half-points.  1pt = 2 units.  18pt → 36, 10pt → 20 etc.
const hp = (pt: number) => pt * 2

// docx `spacing` before/after is in twentieths of a point (twips). 1pt = 20 twips.
const twips = (pt: number) => pt * 20

// ─── fonts & colors ────────────────────────────────────────────────────────────
const F = "Calibri"
const C_BLACK = "000000"
const C_DARK = "1F1F1F"
const C_MID = "444444"
const C_LIGHT = "666666"
const C_RULE = "000000"

// ─── building blocks ──────────────────────────────────────────────────────────

function run(
  text: string,
  opts: {
    bold?: boolean
    italics?: boolean
    size?: number    // pt
    color?: string
    allCaps?: boolean
    characterSpacing?: number
    underline?: boolean
    hyperlink?: boolean
  } = {}
): TextRun {
  return new TextRun({
    text,
    font: F,
    size: hp(opts.size ?? 10),
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
    color: opts.color ?? C_DARK,
    allCaps: opts.allCaps ?? false,
    characterSpacing: opts.characterSpacing,
    underline: opts.underline ? { type: UnderlineType.SINGLE } : undefined,
  })
}

function blankLine(spacingPt = 4): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: twips(spacingPt) } })
}

/** Centered paragraph — for name, contact, headline */
function centered(...children: (TextRun | ExternalHyperlink)[]): Paragraph {
  return new Paragraph({ alignment: AlignmentType.CENTER, children })
}

/**
 * Section heading: UPPERCASE bold text with a solid bottom border (the horizontal rule).
 * Matches: `border-b border-slate-900 text-[8.5px] font-bold uppercase tracking-[0.16em]`
 */
function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: twips(10), after: twips(4) },
    border: {
      bottom: { color: C_RULE, size: 6, space: 1, style: BorderStyle.SINGLE },
    },
    children: [
      run(title, { bold: true, size: 9, allCaps: true, characterSpacing: 32, color: C_BLACK }),
    ],
  })
}

/**
 * Two-column row: bold left text + right-aligned date.
 * Matches the flex justify-between pattern used for experience + education rows.
 */
function titledRow(left: string, right: string, opts: { leftSize?: number; rightSize?: number } = {}): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 0, after: twips(1) },
    children: [
      run(left, { bold: true, size: opts.leftSize ?? 10, color: C_BLACK }),
      new TextRun({ text: "\t", font: F }),
      run(right, { size: opts.rightSize ?? 9, color: C_MID }),
    ],
  })
}

/** Body paragraph — matches `text-[9.5px] leading-[1.45] text-slate-800` */
function bodyPara(text: string, opts: { size?: number; color?: string; spacingAfter?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: twips(opts.spacingAfter ?? 1) },
    children: [run(text, { size: opts.size ?? 10, color: opts.color ?? C_DARK })],
  })
}

/** Disc bullet — matches `<ul class="list-disc">` */
function discBullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 0, after: twips(1) },
    children: [run(text.replace(/^[•\-–—*]\s*/, "").trim(), { size: 10, color: C_DARK })],
  })
}

// ─── safe helpers ──────────────────────────────────────────────────────────────

function safeStr(value: string | null | undefined): string {
  return (value ?? "").trim()
}

function safeArr<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function safeStrArr(value: string[] | null | undefined): string[] {
  return safeArr(value).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
}

function dateRange(startDate: string | null | undefined, endDate: string | null | undefined, isCurrent: boolean | null | undefined): string {
  const start = safeStr(startDate) || "Recent"
  const end = isCurrent ? "Present" : (safeStr(endDate) || "Recent")
  return `${start} - ${end}`
}

// ─── section builders ──────────────────────────────────────────────────────────

function buildHeader(resume: Resume): Paragraph[] {
  const paragraphs: Paragraph[] = []

  // Name — uppercase, extrabold, large
  const displayName = safeStr(resume.full_name ?? resume.name)
  if (displayName) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: twips(3) },
        children: [
          run(displayName.toUpperCase(), { bold: true, size: 18, color: C_BLACK, characterSpacing: 16 }),
        ],
      })
    )
  }

  // Contact row — "  |  " separated
  const contactParts = [
    safeStr(resume.location),
    safeStr(resume.email),
    safeStr(resume.phone),
    safeStr(resume.linkedin_url),
    safeStr(resume.portfolio_url),
    safeStr(resume.github_url),
  ].filter(Boolean)

  if (contactParts.length > 0) {
    const children: (TextRun | ExternalHyperlink)[] = []
    const sep = new TextRun({ text: "  |  ", font: F, size: hp(9), color: C_LIGHT })

    for (let i = 0; i < contactParts.length; i++) {
      const part = contactParts[i]!
      const isUrl = part.startsWith("http") || part.startsWith("www") || part.includes("linkedin.com")

      if (isUrl) {
        children.push(
          new ExternalHyperlink({
            link: part.startsWith("http") ? part : `https://${part}`,
            children: [
              new TextRun({ text: part, font: F, size: hp(9), color: "0563C1", underline: { type: UnderlineType.SINGLE, color: "0563C1" } }),
            ],
          })
        )
      } else {
        children.push(run(part, { size: 9, color: C_MID }))
      }

      if (i < contactParts.length - 1) children.push(sep)
    }

    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: twips(2) },
        children,
      })
    )
  }

  // Headline / primary role
  const headline = safeStr(resume.primary_role)
  if (headline) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: twips(6) },
        children: [run(headline, { bold: true, size: 11, color: C_BLACK })],
      })
    )
  }

  return paragraphs
}

function buildProfile(resume: Resume): Paragraph[] {
  const summary = safeStr(resume.summary)
  if (!summary) return []
  return [
    sectionHeading("Professional Summary"),
    bodyPara(summary, { spacingAfter: 8 }),
  ]
}

function buildSkills(resume: Resume): Paragraph[] {
  const skills = resume.skills
  const fallback = safeStrArr(resume.top_skills).slice(0, 12)

  // Mirror preview skillGroups order: Languages, Technical, Certifications, Soft Skills
  const groups: [string, string[]][] = skills
    ? ([
        ["Languages", safeStrArr(skills.languages)],
        ["Technical", safeStrArr(skills.technical)],
        ["Certifications", safeStrArr(skills.certifications)],
        ["Soft Skills", safeStrArr(skills.soft)],
      ] as [string, string[]][]).filter(([, v]) => v.length > 0)
    : []

  if (groups.length === 0 && fallback.length === 0) return []

  const rows: Paragraph[] = []

  if (groups.length > 0) {
    for (const [label, values] of groups) {
      rows.push(
        new Paragraph({
          spacing: { before: 0, after: twips(2) },
          children: [
            run(`${label}: `, { bold: true, size: 10, color: C_BLACK }),
            run(values.join(", "), { size: 10, color: C_DARK }),
          ],
        })
      )
    }
  } else {
    rows.push(
      new Paragraph({
        spacing: { before: 0, after: twips(2) },
        children: [
          run("Core Skills: ", { bold: true, size: 10, color: C_BLACK }),
          run(fallback.join(", "), { size: 10, color: C_DARK }),
        ],
      })
    )
  }

  return [sectionHeading("Summary of Skills and Competencies"), ...rows, blankLine(4)]
}

function buildExperience(resume: Resume): Paragraph[] {
  const work = safeArr(resume.work_experience)
  if (work.length === 0) return []

  const paragraphs: Paragraph[] = [sectionHeading("Professional Experience")]

  for (const item of work.slice(0, 5)) {
    const title = safeStr(item.title)
    const company = safeStr(item.company)
    const titleLine = [title, company].filter(Boolean).join(" | ")
    const dates = dateRange(item.start_date, item.end_date, item.is_current)

    paragraphs.push(titledRow(titleLine || "Role | Company", dates))

    // description (plain text — shown when present, same as preview)
    const description = safeStr(item.description)
    if (description) {
      paragraphs.push(bodyPara(description, { size: 9.5, color: C_MID, spacingAfter: 1 }))
    }

    // achievements as disc bullets (matches `<ul class="list-disc">` in preview)
    const achievements = safeStrArr(item.achievements)
    const bullets = achievements.length > 0
      ? achievements.slice(0, 6)
      : safeStr(item.description)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 6)

    // If description already shown as plain text, only add bullets if they're separate from description
    const showBullets = achievements.length > 0
    if (showBullets) {
      for (const bullet of bullets) {
        paragraphs.push(discBullet(bullet))
      }
    }

    paragraphs.push(blankLine(6))
  }

  return paragraphs
}

function buildProjects(resume: Resume): Paragraph[] {
  const projects = safeArr(resume.projects).slice(0, 3)
  if (projects.length === 0) return []

  const paragraphs: Paragraph[] = [sectionHeading("Selected Projects")]

  for (const item of projects) {
    const name = safeStr(item.name)
    if (name) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 0, after: twips(1) },
          children: [run(name, { bold: true, size: 10, color: C_BLACK })],
        })
      )
    }

    const description = safeStr(item.description)
    if (description) {
      paragraphs.push(bodyPara(description, { size: 9.5, spacingAfter: 1 }))
    }

    const techs = safeStrArr(item.technologies)
    if (techs.length > 0) {
      paragraphs.push(bodyPara(techs.join(", "), { size: 9, color: C_LIGHT, spacingAfter: 4 }))
    } else {
      paragraphs.push(blankLine(4))
    }
  }

  return paragraphs
}

function buildEducation(resume: Resume): Paragraph[] {
  const education = safeArr(resume.education).slice(0, 3)
  if (education.length === 0) return []

  const paragraphs: Paragraph[] = [sectionHeading("Education")]

  for (const item of education) {
    // Preview: "<degree> - <field> | <institution>" on left, dates on right
    const degreeField = [safeStr(item.degree), safeStr(item.field)].filter(Boolean).join(" - ")
    const institution = safeStr(item.institution)
    const left = [degreeField, institution].filter(Boolean).join(" | ") || "Education"
    const dates = dateRange(item.start_date, item.end_date, false)

    paragraphs.push(titledRow(left, dates))

    if (item.gpa) {
      paragraphs.push(bodyPara(`GPA: ${item.gpa}`, { size: 9, color: C_LIGHT, spacingAfter: 2 }))
    }

    paragraphs.push(blankLine(3))
  }

  return paragraphs
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function generateResumeDocx(resume: Resume): Promise<Buffer> {
  const children: Paragraph[] = [
    ...buildHeader(resume),
    ...buildProfile(resume),
    ...buildSkills(resume),
    ...buildExperience(resume),
    ...buildProjects(resume),
    ...buildEducation(resume),
  ]

  const doc = new Document({
    creator: "Hireoven",
    title: safeStr(resume.full_name ?? resume.name) || "Resume",
    description: "Generated by Hireoven AI Resume Studio",
    styles: {
      default: {
        document: {
          run: { font: F, size: hp(10), color: C_DARK },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 900, right: 900 },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
