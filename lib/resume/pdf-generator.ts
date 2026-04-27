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
    paddingTop: 42,
    paddingBottom: 42,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#111111",
    lineHeight: 1.35,
  },
  header: {
    marginBottom: 12,
    textAlign: "center",
  },
  name: {
    fontSize: 17,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  contactRow: {
    fontSize: 8.5,
    color: "#333333",
    lineHeight: 1.25,
  },
  headline: {
    marginTop: 7,
    fontSize: 9.5,
    fontWeight: 700,
    color: "#111111",
  },
  section: {
    marginTop: 9,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    borderBottomWidth: 1,
    borderBottomColor: "#111111",
    paddingBottom: 1,
    marginBottom: 5,
  },
  paragraph: {
    fontSize: 9.3,
    color: "#222222",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 9.4,
    fontWeight: 700,
  },
  itemSubtle: {
    fontSize: 8.5,
    color: "#444444",
  },
  bullet: {
    marginLeft: 8,
    marginTop: 2,
    fontSize: 9,
  },
  skillGroup: {
    marginBottom: 3,
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
  const role = resume.primary_role ?? resume.name ?? null
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
          h(Text, { style: styles.sectionTitle }, "Technical Skills"),
          ...[
            ["Languages", resume.skills.languages],
            ["Technical", resume.skills.technical],
            ["Certifications", resume.skills.certifications],
            ["Soft Skills", resume.skills.soft],
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
          ? h(Text, { style: styles.contactRow }, contact.join(" | "))
          : null,
        role ? h(Text, { style: styles.headline }, role) : null
      ),
      resume.summary
        ? h(
            View,
            { style: styles.section },
            h(Text, { style: styles.sectionTitle }, "Professional Summary"),
            h(Text, { style: styles.paragraph }, resume.summary)
          )
        : null,
      skillsSection,
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
                    h(Text, { style: styles.itemTitle }, `${item.title} | ${item.company}`)
                  ),
                  h(
                    Text,
                    { style: styles.itemSubtle },
                    `${item.start_date || "Unknown"} - ${item.is_current ? "Present" : item.end_date ?? "Unknown"}`
                  )
                ),
                item.description ? h(Text, { style: styles.itemSubtle }, item.description) : null,
                ...item.achievements.map((achievement, bulletIndex) =>
                  h(Text, { key: `${item.company}-${bulletIndex}`, style: styles.bullet }, `• ${achievement}`)
                )
              )
            )
          )
        : null,
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
