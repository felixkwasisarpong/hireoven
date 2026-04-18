"use client"

import { useMemo, useState } from "react"
import { ChevronDown, PencilLine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"

type SectionKey = "contact" | "summary" | "experience" | "education" | "skills" | "projects"

function ResumeSection({
  id,
  title,
  children,
  defaultOpen = false,
}: {
  id: SectionKey
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
      >
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500">
            <PencilLine className="h-3.5 w-3.5" />
            Edit soon
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-gray-500 transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {open && <div className="border-t border-slate-200/75 px-4 py-4">{children}</div>}
    </section>
  )
}

export default function ParsedResumeView({ resume }: { resume: Resume }) {
  const skills = useMemo(() => {
    if (!resume.skills) return []

    return [
      ["Technical", resume.skills.technical],
      ["Soft", resume.skills.soft],
      ["Languages", resume.skills.languages],
      ["Certifications", resume.skills.certifications],
    ].filter(([, values]) => values.length > 0) as Array<[string, string[]]>
  }, [resume.skills])

  return (
    <div className="space-y-3">
      <ResumeSection id="contact" title="Contact" defaultOpen>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Full name", resume.full_name],
            ["Email", resume.email],
            ["Phone", resume.phone],
            ["Location", resume.location],
            ["LinkedIn", resume.linkedin_url],
            ["Portfolio", resume.portfolio_url],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                {label}
              </p>
              <p className="mt-2 break-words text-sm text-gray-700">{(value as string | null) ?? "Not detected"}</p>
            </div>
          ))}
        </div>
      </ResumeSection>

      <ResumeSection id="summary" title="Summary">
        <p className="text-sm leading-7 text-gray-600">
          {resume.summary ?? "No summary section detected."}
        </p>
      </ResumeSection>

      <ResumeSection id="experience" title="Experience">
        <div className="space-y-3">
          {(resume.work_experience?.length ?? 0) > 0 ? (
            resume.work_experience?.map((item, index) => (
              <article key={`${item.company}-${item.title}-${index}`} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{item.title}</p>
                    <p className="text-sm text-gray-500">{item.company}</p>
                  </div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">
                    {item.start_date || "Unknown"} - {item.is_current ? "Present" : item.end_date ?? "Unknown"}
                  </p>
                </div>
                {item.description && (
                  <p className="mt-3 text-sm leading-7 text-gray-600">{item.description}</p>
                )}
                {item.achievements.length > 0 && (
                  <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
                    {item.achievements.map((achievement) => (
                      <p key={achievement}>{achievement}</p>
                    ))}
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">No work experience detected yet.</p>
          )}
        </div>
      </ResumeSection>

      <ResumeSection id="education" title="Education">
        <div className="space-y-3">
          {(resume.education?.length ?? 0) > 0 ? (
            resume.education?.map((item, index) => (
              <article key={`${item.institution}-${index}`} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-4">
                <p className="text-base font-semibold text-gray-900">{item.institution}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {[item.degree, item.field].filter(Boolean).join(" · ") || "Degree details not detected"}
                </p>
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-gray-400">
                  {item.start_date || "Unknown"} - {item.end_date ?? "Unknown"}
                  {item.gpa ? ` · GPA ${item.gpa}` : ""}
                </p>
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">No education entries detected yet.</p>
          )}
        </div>
      </ResumeSection>

      <ResumeSection id="skills" title="Skills">
        <div className="space-y-4">
          {skills.length > 0 ? (
            skills.map(([label, values]) => (
              <div key={label}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {label}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {values.map((value) => (
                    <span
                      key={value}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">No skills section detected yet.</p>
          )}
        </div>
      </ResumeSection>

      <ResumeSection id="projects" title="Projects">
        <div className="space-y-3">
          {(resume.projects?.length ?? 0) > 0 ? (
            resume.projects?.map((project, index) => (
              <article key={`${project.name}-${index}`} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-4">
                <p className="text-base font-semibold text-gray-900">{project.name}</p>
                <p className="mt-2 text-sm leading-7 text-gray-600">{project.description}</p>
                {project.technologies.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {project.technologies.map((technology) => (
                      <span
                        key={technology}
                        className="rounded-full bg-[#FFF1E8] px-3 py-1 text-sm font-medium text-[#062246]"
                      >
                        {technology}
                      </span>
                    ))}
                  </div>
                )}
                {project.url && (
                  <p className="mt-3 text-sm text-[#FF5C18]">{project.url}</p>
                )}
              </article>
            ))
          ) : (
            <p className="text-sm text-gray-500">No projects detected yet.</p>
          )}
        </div>
      </ResumeSection>
    </div>
  )
}
