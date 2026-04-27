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
    <section className="border-b border-slate-200/85 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 bg-slate-50/40 px-1 py-3.5 text-left transition hover:bg-slate-50/90 sm:px-0"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <PencilLine className="h-3 w-3" />
            Soon
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-500 transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      {open && <div className="border-t border-slate-200/80 pb-6 pt-4">{children}</div>}
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
    <div className="border border-slate-200/85 bg-white">
      <ResumeSection id="contact" title="Contact" defaultOpen>
        <div className="grid gap-px bg-slate-200/70 sm:grid-cols-2">
          {[
            ["Full name", resume.full_name],
            ["Email", resume.email],
            ["Phone", resume.phone],
            ["Location", resume.location],
            ["LinkedIn", resume.linkedin_url],
            ["Portfolio", resume.portfolio_url],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-[#FDFDFC] px-3 py-3 sm:px-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {label}
              </p>
              <p className="mt-1.5 break-words text-sm leading-relaxed text-slate-800">{(value as string | null) ?? "—"}</p>
            </div>
          ))}
        </div>
      </ResumeSection>

      <ResumeSection id="summary" title="Summary">
        <p className="text-sm leading-[1.7] text-slate-700">
          {resume.summary ?? "No summary section detected."}
        </p>
      </ResumeSection>

      <ResumeSection id="experience" title="Experience">
        <div className="space-y-3">
          {(resume.work_experience?.length ?? 0) > 0 ? (
            resume.work_experience?.map((item, index) => (
              <article
                key={`${item.company}-${item.title}-${index}`}
                className="border-b border-slate-200/80 py-4 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-base font-medium text-slate-900">{item.title}</p>
                    <p className="text-sm text-slate-600">{item.company}</p>
                  </div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                    {item.start_date || "—"} – {item.is_current ? "Present" : item.end_date ?? "—"}
                  </p>
                </div>
                {item.description && (
                  <p className="mt-3 text-sm leading-[1.7] text-slate-700">{item.description}</p>
                )}
                {item.achievements.length > 0 && (
                  <div className="mt-3 space-y-2 text-sm leading-[1.65] text-slate-700">
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
              <article
                key={`${item.institution}-${index}`}
                className="border-b border-slate-200/80 py-4 last:border-b-0 last:pb-0"
              >
                <p className="font-serif text-base font-medium text-slate-900">{item.institution}</p>
                <p className="mt-1 text-sm text-slate-700">
                  {[item.degree, item.field].filter(Boolean).join(" · ") || "Degree details not detected"}
                </p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  {item.start_date || "—"} – {item.end_date ?? "—"}
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {label}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {values.map((value) => (
                    <span
                      key={value}
                      className="border border-slate-200/90 bg-white px-2.5 py-0.5 text-sm text-slate-800"
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
              <article
                key={`${project.name}-${index}`}
                className="border-b border-slate-200/80 py-4 last:border-b-0 last:pb-0"
              >
                <p className="font-serif text-base font-medium text-slate-900">{project.name}</p>
                <p className="mt-2 text-sm leading-[1.7] text-slate-700">{project.description}</p>
                {project.technologies.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.technologies.map((technology) => (
                      <span
                        key={technology}
                        className="border border-slate-200/80 bg-slate-50/80 px-2 py-0.5 text-sm text-slate-800"
                      >
                        {technology}
                      </span>
                    ))}
                  </div>
                )}
                {project.url && (
                  <p className="mt-3 text-sm text-slate-600 underline decoration-slate-300 underline-offset-2">
                    {project.url}
                  </p>
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
