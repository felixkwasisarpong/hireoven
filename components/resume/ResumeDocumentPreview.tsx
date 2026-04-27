import { Fragment, type ReactNode } from "react"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Profile, Resume, WorkExperience } from "@/types"
import type { ResumeGenerationInput } from "@/types/resume-hub"

export type ResumePreviewSectionType =
  | "personal"
  | "profile"
  | "skills"
  | "experience"
  | "education"
  | "projects"
  | "publications"
  | "achievements"
  | "awards"
  | "certificates"
  | "languages"
  | "hobbies"
  | "custom"

export type ResumePreviewSection = {
  id: string
  type: ResumePreviewSectionType
  title: string
  enabled: boolean
  order: number
}

export type ResumePreviewCustomSection = {
  title: string
  content: string
}

export type ResumePreviewPersonalField = {
  label: string
  value: string
}

type ResumeDocumentPreviewProps = {
  resume: Resume | null
  input?: ResumeGenerationInput
  profile?: Profile | null
  className?: string
  sectionOrder?: ResumePreviewSection[]
  customSections?: Record<string, ResumePreviewCustomSection>
  personalFields?: ResumePreviewPersonalField[]
  /** When set, preview regions highlight on hover and navigate the studio editor on click. */
  onSectionNavigate?: (sectionId: string) => void
}

function PreviewSectionShell({
  sectionId,
  onNavigate,
  children,
}: {
  sectionId: string
  onNavigate: (sectionId: string) => void
  children: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open this section in the editor"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onNavigate(sectionId)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onNavigate(sectionId)
        }
      }}
      className={cn(
        "group relative mb-0.5 rounded-lg px-0.5 py-0.5 outline-none transition",
        "hover:ring-2 hover:ring-[#5B4DFF]/45 hover:ring-offset-2 hover:ring-offset-white",
        "focus-visible:ring-2 focus-visible:ring-[#5B4DFF]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      )}
    >
      {children}
    </div>
  )
}

function firstUsefulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean))) as string[]
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function safeStringArray(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function splitLines(value?: string | null) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
}

function dateRange(item: WorkExperience) {
  const start = item.start_date || "Recent"
  const end = item.is_current ? "Present" : item.end_date || "Recent"
  return `${start} - ${end}`
}

function sectionTitle(title: string) {
  return (
    <p className="mb-1.5 border-b border-slate-900 pb-0.5 text-[8.5px] font-bold uppercase tracking-[0.16em] text-slate-950">
      {title}
    </p>
  )
}

function buildDraftExperience(input?: ResumeGenerationInput): WorkExperience[] {
  if (!input) return []
  return [
    {
      title: input.targetRole || "Target Role",
      company: input.targetIndustry || "Recent Experience",
      start_date: "Recent",
      end_date: null,
      is_current: true,
      description:
        firstUsefulLine([input.manualInput, input.linkedinSummary, input.jobDescription].filter(Boolean).join("\n")) ??
        "Add verified responsibilities, systems owned, and measurable outcomes.",
      achievements: [
        "Refine this draft with quantified impact, production context, and role-relevant technologies.",
      ],
    },
  ]
}

export default function ResumeDocumentPreview({
  resume,
  input,
  profile,
  className,
  sectionOrder,
  customSections,
  personalFields,
  onSectionNavigate,
}: ResumeDocumentPreviewProps) {
  if (!resume && !input) {
    return (
      <div className={cn("flex h-full min-h-[520px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center", className)}>
        <FileText className="h-9 w-9 text-slate-300" />
        <p className="mt-3 text-[13px] font-semibold text-slate-600">No resume preview yet</p>
        <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-slate-400">
          Generate a resume or select one to improve or tailor.
        </p>
      </div>
    )
  }

  const name = (resume?.full_name ?? profile?.full_name ?? resume?.name ?? "Your Name").toUpperCase()
  const role = resume?.primary_role ?? input?.targetRole ?? profile?.desired_roles?.[0] ?? "Target Role"
  const contact = unique([
    resume?.location ?? profile?.desired_locations?.[0],
    resume?.email ?? profile?.email,
    resume?.phone,
    resume?.linkedin_url,
    resume?.portfolio_url,
    resume?.github_url,
    ...(personalFields ?? []).map((field) => field.value ? `${field.label}: ${field.value}` : null),
  ])
  const summary =
    resume?.summary ??
    firstUsefulLine(input?.linkedinSummary ?? "") ??
    firstUsefulLine(input?.manualInput ?? "") ??
    `${role} candidate${input?.targetIndustry ? ` targeting ${input.targetIndustry}` : ""}. Review and refine before applying.`
  const workExperience = safeArray(resume?.work_experience)
  const projects = safeArray(resume?.projects)
  const education = safeArray(resume?.education)
  const work = workExperience.length ? workExperience : buildDraftExperience(input)
  const languages = safeStringArray(resume?.skills?.languages)
  const technicalSkills = safeStringArray(resume?.skills?.technical)
  const certifications = safeStringArray(resume?.skills?.certifications)
  const softSkills = safeStringArray(resume?.skills?.soft)
  const skillGroups = resume?.skills
    ? [
        ["Languages", languages],
        ["Technical", technicalSkills],
        ["Certifications", certifications],
        ["Soft Skills", softSkills],
      ].filter(([, values]) => Array.isArray(values) && values.length > 0) as Array<[string, string[]]>
    : []
  const fallbackSkills = unique([...safeStringArray(resume?.top_skills), ...safeStringArray(profile?.top_skills)]).slice(0, 12)
  const orderedSections = sectionOrder?.filter((section) => section.enabled).sort((a, b) => a.order - b.order)
  const shouldRenderHeader = !orderedSections || orderedSections.some((section) => section.type === "personal")
  const personalSectionId = orderedSections?.find((section) => section.type === "personal")?.id ?? "personal"
  const interactive = Boolean(onSectionNavigate)

  const wrapSection = (sectionId: string, inner: ReactNode) => {
    if (!inner) return null
    if (!interactive || !onSectionNavigate) return <Fragment key={sectionId}>{inner}</Fragment>
    return (
      <PreviewSectionShell key={sectionId} sectionId={sectionId} onNavigate={onSectionNavigate}>
        {inner}
      </PreviewSectionShell>
    )
  }

  const renderProfileSection = (title = "Professional Summary") => (
    <section key="profile">
      {sectionTitle(title)}
      <p className="whitespace-pre-line text-[9.5px] leading-[1.5] text-slate-800">{summary}</p>
    </section>
  )

  const renderSkillsSection = (title = "Technical Skills") => (
    <section key="skills">
      {sectionTitle(title)}
      {skillGroups.length > 0 ? (
        <div className="space-y-1">
          {skillGroups.map(([label, values]) => (
            <p key={label} className="text-[9.5px] leading-[1.45] text-slate-800">
              <span className="font-bold text-slate-950">{label}: </span>
              {values.join(", ")}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-[9.5px] leading-[1.45] text-slate-800">
          <span className="font-bold text-slate-950">Core Skills: </span>
          {fallbackSkills.length ? fallbackSkills.join(", ") : "Add verified tools, languages, platforms, and domain skills."}
        </p>
      )}
    </section>
  )

  const renderExperienceSection = (title = "Work Experience") =>
    work.length > 0 ? (
      <section key="experience">
        {sectionTitle(title)}
        <div className="space-y-2.5">
          {work.slice(0, 5).map((item, index) => {
            const achievements = safeStringArray(item.achievements)
            const fallbackAchievements = item.description ? [] : ["Add verified impact bullets for this role."]
            const bullets = achievements.length ? achievements : fallbackAchievements

            return (
              <div key={`${item.company}-${item.title}-${index}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[9.5px] font-bold text-slate-950">
                    {item.title || "Role"} | {item.company || "Company"}
                  </p>
                  <p className="shrink-0 text-[8.5px] text-slate-700">{dateRange(item)}</p>
                </div>
                {item.description && (
                  <p className="mt-0.5 whitespace-pre-line text-[9px] leading-[1.45] text-slate-700">{item.description}</p>
                )}
                {bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-3 text-[9px] leading-[1.4] text-slate-800">
                    {bullets.slice(0, 4).map((achievement) => (
                      <li key={achievement}>{achievement}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </section>
    ) : null

  const renderProjectsSection = (title = "Selected Projects") =>
    projects.length > 0 ? (
      <section key="projects">
        {sectionTitle(title)}
        <div className="space-y-2">
          {projects.slice(0, 3).map((project, index) => {
            const technologies = safeStringArray(project.technologies)

            return (
              <div key={`${project.name}-${index}`}>
                <p className="text-[9.5px] font-bold text-slate-950">{project.name || `Project ${index + 1}`}</p>
                {project.description && (
                  <p className="whitespace-pre-line text-[9px] leading-[1.45] text-slate-800">{project.description}</p>
                )}
                {technologies.length > 0 && (
                  <p className="text-[8.5px] text-slate-600">{technologies.join(", ")}</p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    ) : null

  const renderEducationSection = (title = "Education") =>
    education.length > 0 ? (
      <section key="education">
        {sectionTitle(title)}
        <div className="space-y-1.5">
          {education.slice(0, 3).map((item, index) => (
            <div key={`${item.institution}-${index}`} className="flex items-baseline justify-between gap-3">
              <p className="text-[9.5px] font-bold text-slate-950">
                {[item.degree, item.field].filter(Boolean).join(" - ") || "Education"} | {item.institution || "Institution"}
              </p>
              <p className="shrink-0 text-[8.5px] text-slate-700">
                {item.start_date || "Recent"} - {item.end_date ?? "Present"}
              </p>
            </div>
          ))}
        </div>
      </section>
    ) : null

  const renderCustomTextSection = (section: ResumePreviewSection) => {
    const custom = customSections?.[section.id]
    const content = custom?.content?.trim()
    if (!content) return null

    return (
      <section key={section.id}>
        {sectionTitle(custom?.title || section.title)}
        <div className="space-y-1 text-[9.5px] leading-[1.45] text-slate-800">
          {splitLines(content).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
    )
  }

  const renderSection = (section: ResumePreviewSection) => {
    switch (section.type) {
      case "personal":
        return null
      case "profile":
        return renderProfileSection(section.title)
      case "skills":
        return renderSkillsSection(section.title)
      case "experience":
        return renderExperienceSection(section.title)
      case "education":
        return renderEducationSection(section.title)
      case "projects":
        return renderProjectsSection(section.title)
      case "publications":
      case "achievements":
      case "awards":
      case "certificates":
      case "languages":
      case "hobbies":
      case "custom":
        return renderCustomTextSection(section)
      default:
        return null
    }
  }
  const contentSections = orderedSections
    ? orderedSections
        .filter((section) => section.type !== "personal")
        .map((section) => wrapSection(section.id, renderSection(section)))
        .filter(Boolean)
    : (
        [
          { id: "profile", node: renderProfileSection() },
          { id: "skills", node: renderSkillsSection() },
          { id: "experience", node: renderExperienceSection() },
          { id: "projects", node: renderProjectsSection() },
          { id: "education", node: renderEducationSection() },
        ] as const
      )
        .map(({ id, node }) => wrapSection(id, node))
        .filter(Boolean)

  const headerBlock = (
    <header className="text-center">
      <h3 className="text-[16px] font-extrabold uppercase tracking-[0.08em] text-slate-950">{name}</h3>
      {contact.length > 0 && (
        <p className="mt-1 text-[8.5px] leading-snug text-slate-700">{contact.join(" | ")}</p>
      )}
      <p className="mt-2 text-[10px] font-semibold text-slate-900">{role}</p>
    </header>
  )

  return (
    <div className={cn("max-h-[680px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100/70 p-3 shadow-inner", className)}>
      <article className="mx-auto min-h-[720px] w-full max-w-[620px] bg-white px-8 py-7 font-sans text-[10px] leading-[1.45] text-slate-950 shadow-sm">
        {shouldRenderHeader &&
          (interactive && onSectionNavigate ? (
            <PreviewSectionShell sectionId={personalSectionId} onNavigate={onSectionNavigate}>
              {headerBlock}
            </PreviewSectionShell>
          ) : (
            headerBlock
          ))}

        <div className={cn("space-y-3", shouldRenderHeader ? "mt-4" : "mt-0")}>
          {contentSections.length > 0 ? contentSections : (
            <section>
              {sectionTitle("Resume Content")}
              <p className="text-[9.5px] leading-[1.45] text-slate-600">Add sections in the editor to build your resume preview.</p>
            </section>
          )}
        </div>
      </article>
    </div>
  )
}
