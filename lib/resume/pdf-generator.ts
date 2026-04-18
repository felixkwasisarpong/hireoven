import React from "react"
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer"
import type { Resume } from "@/types"

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111111",
    lineHeight: 1.4,
  },
  header: {
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#D4D4D4",
    paddingBottom: 10,
  },
  name: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 6,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 9,
    color: "#333333",
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 7,
  },
  paragraph: {
    fontSize: 10,
    color: "#222222",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 10,
    fontWeight: 700,
  },
  itemSubtle: {
    fontSize: 9,
    color: "#444444",
  },
  bullet: {
    marginLeft: 8,
    marginTop: 3,
    fontSize: 9.5,
  },
  skillGroup: {
    marginBottom: 5,
  },
})

function joinContact(resume: Resume) {
  return [
    resume.email,
    resume.phone,
    resume.location,
    resume.linkedin_url,
    resume.portfolio_url,
  ].filter(Boolean)
}

function ResumeDocument({ resume }: { resume: Resume }) {
  const contact = joinContact(resume)
  const h = React.createElement
  const skillsSection =
    resume.skills &&
    resume.skills.technical.length +
      resume.skills.soft.length +
      resume.skills.languages.length +
      resume.skills.certifications.length >
      0
      ? h(
          View,
          { style: styles.section },
          h(Text, { style: styles.sectionTitle }, "Skills"),
          ...[
            ["Technical", resume.skills.technical],
            ["Soft", resume.skills.soft],
            ["Languages", resume.skills.languages],
            ["Certifications", resume.skills.certifications],
          ]
            .filter(([, values]) => values.length > 0)
            .map(([label, values]) => {
              const sectionLabel = label as string
              const sectionValues = values as string[]
              return h(
                View,
                { key: sectionLabel, style: styles.skillGroup },
                h(Text, { style: styles.itemTitle }, sectionLabel),
                h(Text, { style: styles.paragraph }, sectionValues.join(", "))
              )
            })
        )
      : null

  return h(
    Document,
    {
      title: `${resume.full_name ?? resume.name ?? "Resume"} - Hireoven`,
      author: "Hireoven",
      subject: "Resume export",
    },
    h(
      Page,
      { size: "LETTER", style: styles.page },
      h(
        View,
        { style: styles.header },
        h(Text, { style: styles.name }, resume.full_name ?? resume.name ?? resume.file_name),
        contact.length > 0
          ? h(
              View,
              { style: styles.contactRow },
              ...contact.map((value) => h(Text, { key: value }, value))
            )
          : null
      ),
      resume.summary
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Summary"),
            h(Text, { style: styles.paragraph }, resume.summary)
          )
        : null,
      (resume.work_experience?.length ?? 0) > 0
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Work Experience"),
            ...(resume.work_experience ?? []).map((item, index) =>
              h(
                View,
                { key: `${item.company}-${item.title}-${index}`, wrap: false, style: { marginBottom: 10 } },
                h(
                  View,
                  { style: styles.rowBetween },
                  h(
                    View,
                    null,
                    h(Text, { style: styles.itemTitle }, item.title),
                    h(Text, { style: styles.itemSubtle }, item.company)
                  ),
                  h(
                    Text,
                    { style: styles.itemSubtle },
                    `${item.start_date || "Unknown"} - ${item.is_current ? "Present" : item.end_date ?? "Unknown"}`
                  )
                ),
                item.description ? h(Text, { style: styles.paragraph }, item.description) : null,
                ...item.achievements.map((achievement, bulletIndex) =>
                  h(Text, { key: `${item.company}-${bulletIndex}`, style: styles.bullet }, `• ${achievement}`)
                )
              )
            )
          )
        : null,
      skillsSection,
      (resume.education?.length ?? 0) > 0
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Education"),
            ...(resume.education ?? []).map((item, index) =>
              h(
                View,
                { key: `${item.institution}-${index}`, style: { marginBottom: 8 } },
                h(
                  View,
                  { style: styles.rowBetween },
                  h(
                    View,
                    null,
                    h(Text, { style: styles.itemTitle }, item.institution),
                    h(
                      Text,
                      { style: styles.itemSubtle },
                      [item.degree, item.field].filter(Boolean).join(" · ") || "Education"
                    )
                  ),
                  h(
                    Text,
                    { style: styles.itemSubtle },
                    `${item.start_date || "Unknown"} - ${item.end_date ?? "Unknown"}${item.gpa ? ` · GPA ${item.gpa}` : ""}`
                  )
                )
              )
            )
          )
        : null,
      (resume.projects?.length ?? 0) > 0
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Projects"),
            ...(resume.projects ?? []).map((project, index) =>
              h(
                View,
                { key: `${project.name}-${index}`, style: { marginBottom: 8 } },
                h(Text, { style: styles.itemTitle }, project.name),
                h(Text, { style: styles.paragraph }, project.description),
                project.technologies.length > 0
                  ? h(Text, { style: styles.itemSubtle }, project.technologies.join(", "))
                  : null,
                project.url ? h(Text, { style: styles.itemSubtle }, project.url) : null
              )
            )
          )
        : null
    )
  )
}

export async function generateResumePDF(resume: Resume): Promise<Buffer> {
  return renderToBuffer(ResumeDocument({ resume }))
}
