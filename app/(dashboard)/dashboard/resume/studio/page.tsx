"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Download,
  Eye,
  FileText,
  Flag,
  GraduationCap,
  Italic,
  Languages,
  List,
  Loader2,
  Medal,
  Palette,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Star,
  Strikethrough,
  Target,
  Trophy,
  Type,
  Underline,
  Undo2,
  User,
} from "lucide-react"
import ResumeDocumentPreview, {
  type ResumePreviewCustomSection,
  type ResumePreviewPersonalField,
  type ResumePreviewSectionType,
} from "@/components/resume/ResumeDocumentPreview"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useToast } from "@/components/ui/ToastProvider"
import { buildStudioSectionChecks } from "@/lib/resume/studio-section-analysis"
import { useResumeHubData } from "@/lib/resume/use-resume-hub-data"
import { cn } from "@/lib/utils"
import {
  addSkillToSkillsText,
  buildLocalTailorAnalysis,
  normalizeTailorAnalysis,
  sanitizeTailorSummaryText,
} from "@/lib/resume/tailor-analysis"
import { createResumeSnapshot } from "@/lib/resume/hub"
import type { Profile, Resume } from "@/types"
import type { TailorAnalysisResult, TailorFix, TailorRoleAlignment, TailorWorkflowStep } from "@/types/tailor-analysis"

type StudioMode = "preview" | "tailor"
type JobSource = "saved" | "paste"
type ResumeSectionType = ResumePreviewSectionType

type ResumeSectionState = {
  id: string
  type: ResumeSectionType
  title: string
  icon?: string
  premium?: boolean
  collapsed: boolean
  enabled: boolean
  order: number
}

type ExperienceDraft = {
  company: string
  role: string
  city: string
  country: string
  from: string
  to: string
  current: boolean
  description: string
}

type EducationDraft = {
  school: string
  field: string
  degree: string
  location: string
  country: string
  from: string
  to: string
  current: boolean
  description: string
}

type PublicationDraft = {
  title: string
  authors: string
  publisher: string
  url: string
  date: string
  description: string
}

type PersonalCustomField = {
  id: string
  label: string
  value: string
}

type StructuredEntry = {
  id: string
  title: string
  org: string
  date: string
  credId: string
  description: string
}

type EditorSnapshot = {
  sections: ResumeSectionState[]
  customSections: Record<string, ResumePreviewCustomSection>
  personalInfo: {
    title: string
    firstName: string
    lastName: string
    phone: string
    email: string
    dateOfBirth: string
    nationality: string
    address: string
    city: string
    state: string
    country: string
    postalCode: string
    website: string
  }
  personalCustomFields: PersonalCustomField[]
  headline: string
  skillsText: string
  experienceDrafts: ExperienceDraft[]
  educationDrafts: EducationDraft[]
  projectsDraft: string
  publicationDrafts: PublicationDraft[]
  profileSummary: string
}

const MODES: Array<{ id: StudioMode; label: string; icon: ElementType }> = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "tailor", label: "Tailor Resume", icon: Target },
]

const INITIAL_SECTIONS: ResumeSectionState[] = [
  { id: "personal", type: "personal", title: "Personal Information", collapsed: false, enabled: true, order: 0 },
  { id: "profile", type: "profile", title: "Profile", collapsed: true, enabled: true, order: 1 },
  { id: "skills", type: "skills", title: "Summary of Skills and Competencies", collapsed: true, enabled: true, order: 2, premium: true },
  { id: "experience", type: "experience", title: "Professional Experience", collapsed: true, enabled: true, order: 3, premium: true },
  { id: "education", type: "education", title: "Education", collapsed: true, enabled: true, order: 4 },
  { id: "projects", type: "projects", title: "Projects", collapsed: true, enabled: true, order: 5, premium: true },
  { id: "publications", type: "publications", title: "Publications", collapsed: true, enabled: true, order: 6, premium: true },
]

const SECTION_ICONS: Record<ResumeSectionType, ElementType> = {
  personal: User,
  profile: FileText,
  skills: Sparkles,
  experience: Briefcase,
  education: GraduationCap,
  projects: Star,
  publications: BookOpen,
  achievements: Trophy,
  awards: Award,
  certificates: Medal,
  languages: Languages,
  hobbies: Palette,
  custom: FileText,
}

const ADD_SECTIONS = [
  { type: "achievements" as const, label: "Achievements", icon: Trophy,       desc: "Notable accomplishments with measurable impact" },
  { type: "awards" as const,       label: "Awards",       icon: Award,        desc: "Prizes, honors, and recognitions received" },
  { type: "certificates" as const, label: "Certificates", icon: Medal,        desc: "Professional certifications and credentials" },
  { type: "education" as const,    label: "Education",    icon: GraduationCap, desc: "Degrees, diplomas, and academic history" },
  { type: "languages" as const,    label: "Languages",    icon: Languages,    desc: "Languages spoken and proficiency levels" },
  { type: "projects" as const,     label: "Projects",     icon: Star,         desc: "Side projects, open-source, and portfolio work" },
  { type: "publications" as const, label: "Publications", icon: BookOpen,     desc: "Research papers, articles, and books" },
]

function validMode(value: string | null): StudioMode {
  return value === "tailor" ? "tailor" : "preview"
}

function skillsTextToSkills(text: string): { technical: string[]; soft: string[]; languages: string[]; certifications: string[] } {
  const result = { technical: [] as string[], soft: [] as string[], languages: [] as string[], certifications: [] as string[] }
  if (!text.trim()) return result

  const hasCategories = text.split("\n").some((line) => /^[A-Za-z][A-Za-z\s]+:\s*.+/.test(line.trim()))
  if (hasCategories) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z\s]+):\s*(.+)/)
      if (!m) continue
      const key = m[1]!.toLowerCase().trim()
      const vals = m[2]!.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
      if (/lang/.test(key)) result.languages.push(...vals)
      else if (/cert|licen/.test(key)) result.certifications.push(...vals)
      else if (/soft|interpersonal|people|commun/.test(key)) result.soft.push(...vals)
      else result.technical.push(...vals)
    }
  } else {
    result.technical = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  }
  return result
}

function splitName(fullName?: string | null) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  }
}

function splitTextLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function normalizeForBulletMatch(s: string): string {
  return s
    .replace(/^[•–—‘’“”•\-–—*]\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["""'']/g, '"')
}

function findBestMatchingLineIndex(description: string, original: string): number {
  const lines = description.split(/\r?\n/)
  if (!original.trim()) return -1
  const normOrig = normalizeForBulletMatch(original)

  // 1. Exact normalized match
  for (let i = 0; i < lines.length; i++) {
    if (normalizeForBulletMatch(lines[i]!) === normOrig) return i
  }
  // 2. Substring containment in either direction
  for (let i = 0; i < lines.length; i++) {
    const normLine = normalizeForBulletMatch(lines[i]!)
    if (normLine && normOrig && (normLine.includes(normOrig) || normOrig.includes(normLine))) return i
  }
  // 3. First-6-words prefix match
  const origHead = normOrig.split(/\s+/).slice(0, 6).join(" ")
  for (let i = 0; i < lines.length; i++) {
    const lineHead = normalizeForBulletMatch(lines[i]!).split(/\s+/).slice(0, 6).join(" ")
    if (origHead.length > 10 && lineHead.length > 10 && origHead === lineHead) return i
  }
  return -1
}

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[12px] font-semibold text-slate-700">{children}</p>
}

function TextInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value?: string | null
  placeholder?: string
  onChange?: (value: string) => void
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
      />
    </label>
  )
}

function RichTextEditor({
  label,
  value,
  rows = 6,
  onChange,
  sectionId,
  sectionType,
  aiLoading,
  onAiWrite,
}: {
  label?: string
  value: string
  rows?: number
  onChange: (value: string) => void
  sectionId?: string
  sectionType?: ResumeSectionType
  aiLoading?: boolean
  onAiWrite?: (value: string, sectionId: string, sectionType: ResumeSectionType) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function replaceSelection(transform: (selected: string) => string) {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end) || "selected text"
    const nextSelected = transform(selected)
    const nextValue = `${value.slice(0, start)}${nextSelected}${value.slice(end)}`
    onChange(nextValue)

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + nextSelected.length)
    })
  }

  function applyControl(control: "strong" | "italic" | "strike" | "underline" | "list") {
    if (control === "list") {
      replaceSelection((selected) =>
        selected
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim()
            if (!trimmed) return ""
            return trimmed.startsWith("•") ? trimmed : `• ${trimmed}`
          })
          .join("\n")
      )
      return
    }

    const wrappers = {
      strong: ["**", "**"],
      italic: ["_", "_"],
      strike: ["~~", "~~"],
      underline: ["<u>", "</u>"],
    } as const
    const [before, after] = wrappers[control]
    replaceSelection((selected) => `${before}${selected}${after}`)
  }

  const controls: Array<{ label: string; icon: ElementType; action: "strong" | "italic" | "strike" | "underline" | "list" }> = [
    { label: "Bold", icon: Type, action: "strong" },
    { label: "Italic", icon: Italic, action: "italic" },
    { label: "Strikethrough", icon: Strikethrough, action: "strike" },
    { label: "Underline", icon: Underline, action: "underline" },
    { label: "Bulleted list", icon: List, action: "list" },
  ]

  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2 text-slate-600">
          {controls.map(({ label, icon: Icon, action }) => (
            <button
              key={action}
              type="button"
              onClick={() => applyControl(action)}
              className="rounded-md p-1.5 hover:bg-slate-50 hover:text-[#5B4DFF]"
              title={label}
              aria-label={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="w-full resize-y px-3 py-3 text-[13px] leading-relaxed text-slate-700 outline-none"
          placeholder="Add section details..."
        />
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={() => {
              if (sectionId && sectionType) onAiWrite?.(value, sectionId, sectionType)
            }}
            disabled={!sectionId || !sectionType || aiLoading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#5B4DFF] to-orange-500 px-4 text-[12px] font-bold text-white"
          >
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiLoading ? "Writing..." : "Scout Writer"}
          </button>
        </div>
      </div>
    </div>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

function EditableResumeSection({
  section,
  children,
  addLabel,
  onAdd,
  onToggleCollapsed,
  onHide,
  onRename,
}: {
  section: ResumeSectionState
  children: ReactNode
  addLabel?: string
  onAdd?: () => void
  onToggleCollapsed: (sectionId: string) => void
  onHide: (sectionId: string) => void
  onRename: (sectionId: string, title: string) => void
}) {
  const Icon = SECTION_ICONS[section.type] ?? FileText
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <section
      id={`studio-editor-section-${section.id}`}
      ref={setNodeRef}
      style={style}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (!section.collapsed || target.closest("button,input,textarea,select,a")) return
        onToggleCollapsed(section.id)
      }}
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm transition",
        section.collapsed ? "cursor-pointer border-slate-200 bg-slate-50/60 hover:border-[#5B4DFF]/40" : "border-slate-200",
        isDragging && "relative z-20 opacity-80 ring-2 ring-[#5B4DFF]/30"
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab text-slate-400 transition hover:text-[#5B4DFF] active:cursor-grabbing"
            aria-label={`Drag ${section.title}`}
          >
            ⇅
          </button>
          <Icon className="h-5 w-5 text-slate-600" />
          <div className="flex items-center gap-2">
            <input
              value={section.title}
              onChange={(event) => onRename(section.id, event.target.value)}
              className="min-w-0 max-w-[320px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[18px] font-bold uppercase tracking-wide text-slate-800 outline-none transition focus:border-[#5B4DFF]/30 focus:bg-white focus:ring-2 focus:ring-[#5B4DFF]/10"
              aria-label={`Rename ${section.title} section`}
            />
            {section.collapsed && <span className="text-[11px] font-semibold text-slate-400">Collapsed</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 text-slate-500">
          <button
            type="button"
            onClick={() => onToggleCollapsed(section.id)}
            className="transition hover:text-[#5B4DFF]"
            aria-label={section.collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`}
          >
            <ChevronDown className={cn("h-4 w-4 transition", section.collapsed ? "" : "rotate-180")} />
          </button>
          <button type="button" onClick={() => onHide(section.id)} className="text-red-500 transition hover:text-red-600" aria-label={`Hide ${section.title}`}>
            <TrashIcon />
          </button>
        </div>
      </div>
      {!section.collapsed && (
        <>
          {children}
          {addLabel && (
            <button
              type="button"
              onClick={onAdd}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-red-300 text-[13px] font-bold text-red-500 transition hover:bg-red-50"
            >
              <Plus className="mr-2 h-4 w-4" />
              {addLabel}
            </button>
          )}
          <div className="mt-5 flex h-12 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
            <ChevronDown className="h-4 w-4 rotate-180" />
          </div>
        </>
      )}
    </section>
  )
}

function ModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: StudioMode
  onModeChange: (mode: StudioMode) => void
}) {
  return (
    <div className="inline-grid w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:w-auto sm:grid-cols-2">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          className={cn(
            "inline-flex h-11 min-w-[180px] items-center justify-center gap-2 border-r border-slate-200 px-4 text-[12.5px] font-bold transition last:border-r-0",
            mode === id ? "bg-indigo-50 text-[#5B4DFF]" : "bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function ResumeSelect({
  resumes,
  selectedId,
  onChange,
}: {
  resumes: Resume[]
  selectedId: string | null
  onChange: (id: string | null) => void
}) {
  return (
    <div>
      <FieldLabel>Select Resume</FieldLabel>
      <select
        value={selectedId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 outline-none focus:border-[#5B4DFF] focus:ring-2 focus:ring-[#5B4DFF]/10"
      >
        {resumes.map((resume) => (
          <option key={resume.id} value={resume.id}>
            {resume.name ?? resume.file_name}
            {resume.is_primary ? " (Active)" : ""}
          </option>
        ))}
      </select>
    </div>
  )
}

function PremiumBadge() {
  return <span className="text-[9px] font-extrabold uppercase tracking-wide text-[#5B4DFF]">Premium</span>
}

function KeywordBadge({ word, tone }: { word: string; tone: "match" | "missing" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ring-1 transition-colors",
        tone === "match"
          ? "bg-gradient-to-br from-emerald-50 to-teal-50/90 text-emerald-900 ring-emerald-200/70"
          : "bg-gradient-to-br from-amber-50 to-orange-50/85 text-amber-950 ring-amber-200/65"
      )}
    >
      {word}
    </span>
  )
}

function roleAlignmentChip(alignment: TailorRoleAlignment | null | undefined) {
  if (alignment === "strong") {
    return { text: "Role alignment: Strong", className: "bg-emerald-100/95 text-emerald-900 ring-emerald-300/50" }
  }
  if (alignment === "moderate") {
    return { text: "Role alignment: Moderate", className: "bg-amber-100/95 text-amber-950 ring-amber-300/45" }
  }
  return { text: "Role alignment: Weak", className: "bg-orange-100/95 text-orange-950 ring-orange-300/45" }
}

function matchExplain(score: number, roleAlignment: TailorRoleAlignment | null | undefined) {
  if (!roleAlignment) {
    return "How well this resume lines up with the job you pasted—run Analyze Match to score keyword overlap."
  }
  if (roleAlignment === "strong") {
    return `This resume is ${score}% aligned on extracted themes from the job description. Strong fit—use fixes to fine-tune wording.`
  }
  if (roleAlignment === "moderate") {
    return `Roughly ${score}% theme overlap with the posting. Review missing keywords and apply only what you can substantiate.`
  }
  return `Low surface overlap (~${score}%) with the posting. Prioritize provable experience edits before skills.`
}

function TailorMatchInsightPanel({ analysis, matchingSkills }: { analysis: TailorAnalysisResult | null; matchingSkills: string[] }) {
  if (!analysis) {
    return (
      <section
        className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 text-[12px] text-slate-500 shadow-sm"
        aria-label="Resume match breakdown"
      >
        Run <span className="font-semibold text-slate-700">Analyze Match</span> to see score, role alignment, and skills gaps.
      </section>
    )
  }

  const { matchScore, roleAlignment, skillSuggestions } = analysis
  const strength = roleAlignmentChip(roleAlignment)
  const safeAdd = skillSuggestions
    .filter((s) => s.status === "missing_supported")
    .map((s) => s.skill)
  const needConfirm = skillSuggestions.filter((s) => s.status === "missing_needs_confirmation").map((s) => s.skill)
  const notRec = skillSuggestions.filter((s) => s.status === "not_recommended").map((s) => s.skill)

  return (
    <section
      className="overflow-hidden rounded-2xl border border-indigo-200/55 bg-gradient-to-br from-white via-indigo-50/35 to-orange-50/45 shadow-[0_10px_40px_-18px_rgba(91,77,255,0.35)]"
      aria-label="Resume match breakdown"
    >
      <div className="relative border-b border-indigo-100/90 bg-gradient-to-r from-indigo-600/[0.06] via-orange-600/[0.05] to-fuchsia-500/[0.06] px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-700/85">Match score</p>
            <p className="mt-0.5 bg-gradient-to-r from-[#5B4DFF] via-orange-600 to-indigo-600 bg-clip-text text-3xl font-black tabular-nums tracking-tight text-transparent sm:text-[2.4rem]">
              {matchScore}
              <span className="text-[0.55em] font-extrabold text-indigo-600/90">%</span>
            </p>
          </div>
          <span
            className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ring-1", strength.className)}
          >
            {strength.text}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600 sm:line-clamp-none">{matchExplain(matchScore, roleAlignment)}</p>
      </div>

      <details className="group border-t border-indigo-100/80">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-white/40 px-3 py-2.5 text-[11px] font-bold text-slate-700 transition hover:bg-indigo-50/50 [&::-webkit-details-marker]:hidden sm:px-4">
          <span className="flex items-center gap-2">
            <span className="text-indigo-800">Keywords &amp; gaps</span>
            <span className="font-normal text-slate-500">
              {matchingSkills.length} match
              {safeAdd.length + needConfirm.length > 0
                ? ` · ${safeAdd.length + needConfirm.length} to review`
                : ""}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-3 border-t border-slate-100/90 p-3 sm:gap-4 sm:p-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[12px] font-bold text-emerald-800">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shadow-sm ring-1 ring-emerald-200/60">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              Present matching skills
            </p>
            <div className="flex min-h-0 flex-wrap gap-1.5">
              {matchingSkills.length === 0 ? (
                <span className="text-[12px] text-slate-500">No overlap extracted yet.</span>
              ) : (
                matchingSkills.map((word) => <KeywordBadge key={word} word={word} tone="match" />)
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Missing (by safety)</p>
            <div className="grid gap-2">
              <div className="rounded-xl border border-emerald-200/60 bg-white/80 p-2.5">
                <p className="text-[11px] font-bold text-emerald-800">Safe to add</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Supported by existing resume context.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {safeAdd.length
                    ? safeAdd.map((s) => <KeywordBadge key={s} word={s} tone="match" />)
                    : <span className="text-[11px] text-slate-400">—</span>}
                </div>
              </div>
              <div className="rounded-xl border border-orange-200/70 bg-orange-50/50 p-2.5">
                <p className="text-[11px] font-bold text-orange-900">Needs confirmation</p>
                <p className="mt-0.5 text-[10px] text-orange-800/90">
                  Confirm before adding — this skill was found in the job description but not clearly supported by your resume.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {needConfirm.length
                    ? needConfirm.map((s) => <KeywordBadge key={s} word={s} tone="missing" />)
                    : <span className="text-[11px] text-slate-400">—</span>}
                </div>
              </div>
              {notRec.length > 0 ? (
                <div className="rounded-xl border border-red-200/60 bg-red-50/40 p-2.5">
                  <p className="text-[11px] font-bold text-red-800">Not recommended</p>
                  <p className="mt-0.5 text-[10px] text-red-800/90">Not added — no resume evidence found.</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {notRec.map((s) => (
                      <span
                        key={s}
                        className="inline-flex rounded-full bg-slate-200/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 line-through"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}

type TailorRecommendedFixesPanelProps = {
  analysis: TailorAnalysisResult | null
  appliedIds: string[]
  applyingId: string | null
  onApply: (fix: TailorFix) => void
  onApplyAllSafe: () => void
  disabled: boolean
}

function TailorRecommendedFixesPanel({
  analysis,
  appliedIds,
  applyingId,
  onApply,
  onApplyAllSafe,
  disabled,
}: TailorRecommendedFixesPanelProps) {
  if (!analysis) {
    return null
  }

  const fixes = analysis.fixes
  if (fixes.length === 0) {
    return (
      <p className="text-[12px] text-slate-500">No automatic fixes for this run—try a fuller job description or local analysis.</p>
    )
  }

  return (
    <details className="group border border-slate-200/90 bg-slate-50/40" open>
      <summary className="flex flex-wrap cursor-pointer list-none items-center justify-between gap-2 rounded-t-xl bg-white/50 px-2.5 py-2 text-left sm:px-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 pr-1">
          <p className="text-[12px] font-bold text-slate-800">Recommended fixes</p>
          <p className="text-[10px] text-slate-500">Tap a row to expand. Apply stays on the right.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
            {fixes.length}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onApplyAllSafe()
            }}
            className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-800 transition hover:border-[#5B4DFF] hover:text-[#5B4DFF] disabled:opacity-50"
          >
            All safe
          </button>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden />
        </div>
      </summary>
      <ul className="max-h-[min(50vh,360px)] space-y-1 overflow-y-auto overscroll-contain border-t border-slate-200/80 p-1.5 pr-1 sm:p-2">
        {fixes.map((fix) => {
          const applied = appliedIds.includes(fix.id)
          const busy = applyingId === fix.id
          const typeLabel = fix.type === "add_skill" ? "Skill" : fix.type === "replace_bullet" ? "Bullet" : "Summary"
          return (
            <li key={fix.id} className="list-none">
              <details className="group/fix overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-start gap-1.5 p-2 pr-1.5 text-left sm:items-center sm:gap-2 sm:pr-2 [&::-webkit-details-marker]:hidden">
                  <span className="mt-0.5 shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-[#5B4DFF] sm:mt-0">
                    {typeLabel}
                  </span>
                  <span className="min-w-0 flex-1 text-[11.5px] font-semibold leading-tight text-slate-900 line-clamp-2">
                    {fix.label}
                  </span>
                  {applied ? (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-emerald-700 sm:mt-0">
                      <Check className="h-3 w-3" />
                      Applied
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onApply(fix)
                      }}
                      className="mt-0.5 h-7 shrink-0 min-w-[4.5rem] rounded-md bg-[#5B4DFF] px-2 text-[10px] font-semibold text-white transition hover:bg-[#493EE6] disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {fix.requiresConfirmation ? "Confirm" : "Apply"}
                    </button>
                  )}
                  <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 sm:mt-0" aria-hidden />
                </summary>
                <div className="space-y-2 border-t border-slate-100 bg-slate-50/40 px-2 py-2 text-[10.5px] text-slate-600 sm:px-2.5">
                  <p className="leading-relaxed">{fix.reason}</p>
                  {fix.type === "add_skill" && (
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div className="rounded-md bg-slate-100/90 p-1.5 text-slate-600">Before: {fix.before || "(empty)"}</div>
                      <div className="rounded-md bg-slate-100/90 p-1.5 text-slate-800">After: {fix.after}</div>
                    </div>
                  )}
                  {fix.type === "replace_bullet" && (
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div className="max-h-32 overflow-y-auto rounded-md bg-slate-100/90 p-1.5 whitespace-pre-wrap">Before: {fix.original || "—"}</div>
                      <div className="max-h-32 overflow-y-auto rounded-md bg-slate-100/90 p-1.5 whitespace-pre-wrap">After: {fix.suggested}</div>
                    </div>
                  )}
                  {fix.type === "replace_summary" && (
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div className="max-h-32 overflow-y-auto rounded-md bg-slate-100/90 p-1.5 whitespace-pre-wrap">Before: {fix.original || "(empty)"}</div>
                      <div className="max-h-32 overflow-y-auto rounded-md bg-slate-100/90 p-1.5 whitespace-pre-wrap">After: {fix.suggested}</div>
                    </div>
                  )}
                  {fix.requiresConfirmation ? (
                    <p className="text-[10px] text-orange-800">
                      Confirm before adding — this skill was found in the job description but not clearly supported by your resume.
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function StickyResumePreview({
  title,
  badge,
  resume,
  profile,
  onDownload,
  sections,
  customSections,
  personalFields,
  onPreviewSectionNavigate,
}: {
  title: string
  badge?: string
  resume: Resume | null
  profile: Profile | null
  onDownload: () => void
  sections?: ResumeSectionState[]
  customSections?: Record<string, ResumePreviewCustomSection>
  personalFields?: ResumePreviewPersonalField[]
  onPreviewSectionNavigate?: (sectionId: string) => void
}) {
  return (
    <aside className="xl:sticky xl:top-4 xl:self-start">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-bold text-slate-950">{title}</p>
          {badge && (
            <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10.5px] font-bold text-[#5B4DFF]">
              {badge}
            </span>
          )}
        </div>
      </div>
      <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="absolute -left-4 top-8 z-10 hidden flex-col gap-2 xl:flex">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-[#5B4DFF]"
            aria-label="View resume"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-[#5B4DFF]"
            aria-label="Download resume"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
        <ResumeDocumentPreview
          resume={resume}
          profile={profile}
          sectionOrder={sections}
          customSections={customSections}
          personalFields={personalFields}
          onSectionNavigate={onPreviewSectionNavigate}
          className="max-h-[calc(100vh-11rem)]"
        />
      </div>
    </aside>
  )
}

export default function ResumeStudioPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { resumes, primaryResume, upsertResume } = useResumeContext()
  const { data: hubData, refresh: refreshHubData } = useResumeHubData()
  const { pushToast } = useToast()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [mode, setMode] = useState<StudioMode>("preview")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("resumeId") ?? primaryResume?.id ?? null)
  const [jobSource, setJobSource] = useState<JobSource>("paste")
  const [selectedTargetJobId, setSelectedTargetJobId] = useState("paste")
  const [jobTitle, setJobTitle] = useState("")
  const [company, setCompany] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [isTailoring, setIsTailoring] = useState(false)
  const [isTailorRefining, setIsTailorRefining] = useState(false)
  const [tailorStep, setTailorStep] = useState<TailorWorkflowStep>("idle")
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null)
  const [appliedFixIds, setAppliedFixIds] = useState<string[]>([])
  const [analysis, setAnalysis] = useState<TailorAnalysisResult | null>(null)
  const [sections, setSections] = useState<ResumeSectionState[]>(INITIAL_SECTIONS)
  const [customSections, setCustomSections] = useState<Record<string, ResumePreviewCustomSection>>({})
  const [aiLoadingSectionId, setAiLoadingSectionId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDraftLatestRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([])
  const lastSnapshotRef = useRef<EditorSnapshot | null>(null)
  const restoringSnapshotRef = useRef(false)
  const initializedResumeIdRef = useRef<string | null>(null)
  const [personalInfo, setPersonalInfo] = useState({
    title: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    dateOfBirth: "",
    nationality: "",
    address: "",
    city: "",
    state: "",
    country: "",
    postalCode: "",
    website: "",
  })
  const [personalCustomFields, setPersonalCustomFields] = useState<PersonalCustomField[]>([])
  const [headline, setHeadline] = useState("")
  const [skillsText, setSkillsText] = useState("")
  const [experienceDrafts, setExperienceDrafts] = useState<ExperienceDraft[]>([])
  const [educationDrafts, setEducationDrafts] = useState<EducationDraft[]>([])
  const [projectsDraft, setProjectsDraft] = useState("")
  const [publicationDrafts, setPublicationDrafts] = useState<PublicationDraft[]>([])
  const [sectionEntries, setSectionEntries] = useState<Record<string, StructuredEntry[]>>({})
  const [profileSummary, setProfileSummary] = useState("")

  useEffect(() => {
    setTailorStep("idle")
    setAppliedFixIds([])
  }, [jobDescription])

  useEffect(() => {
    setMode(validMode(searchParams.get("mode")))
  }, [searchParams])

  // Auto-select a job when navigating from the analyze page (?jobId=...)
  const didAutoSelectJob = useRef(false)
  useEffect(() => {
    if (didAutoSelectJob.current) return
    const preselectedJobId = searchParams.get("jobId")
    if (!preselectedJobId || hubData.targetJobs.length === 0) return
    const job = hubData.targetJobs.find((j) => j.id === preselectedJobId)
    if (!job) return
    didAutoSelectJob.current = true
    setJobSource("saved")
    setSelectedTargetJobId(preselectedJobId)
    setJobTitle(job.title ?? "")
    setCompany(job.company ?? "")
    if (job.description) setJobDescription(job.description)
  }, [hubData.targetJobs, searchParams])

  useEffect(() => {
    async function loadProfile() {
      const response = await fetch("/api/profile", { credentials: "include", cache: "no-store" })
      if (!response.ok) return
      const body = await response.json()
      setProfile((body.profile ?? body) as Profile)
    }
    void loadProfile()
  }, [])

  useEffect(() => {
    if (!selectedId && primaryResume?.id) setSelectedId(primaryResume.id)
  }, [primaryResume, selectedId])

  const selectedResume = resumes.find((resume) => resume.id === selectedId) ?? primaryResume ?? null
  const documentName = (selectedResume?.name ?? "").trim() || (selectedResume?.file_name ?? "").trim() || "Untitled resume"
  const selectedTargetJob = hubData.targetJobs.find((job) => job.id === selectedTargetJobId) ?? null
  const orderedSections = useMemo(
    () => sections.filter((section) => section.enabled).sort((a, b) => a.order - b.order),
    [sections]
  )
  const focusEditorSectionFromPreview = useCallback((sectionId: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, collapsed: false } : s)))
    requestAnimationFrame(() => {
      document.getElementById(`studio-editor-section-${sectionId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
  }, [])

  const previewCustomSections = useMemo<Record<string, ResumePreviewCustomSection>>(() => {
    const publicationsSectionTitle = sections.find((section) => section.id === "publications")?.title ?? "Publications"
    const publicationContent = publicationDrafts
      .map((publication) => [
        publication.title,
        publication.publisher ? `Publisher: ${publication.publisher}` : "",
        publication.date ? `Date: ${publication.date}` : "",
        publication.url ? `URL/ISBN: ${publication.url}` : "",
        publication.description,
      ].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n")

    return {
      ...customSections,
      publications: {
        title: publicationsSectionTitle,
        content: publicationContent,
      },
    }
  }, [customSections, publicationDrafts, sections])
  const sectionChecks = useMemo(
    () =>
      buildStudioSectionChecks({
        profileSummary,
        experienceDrafts,
        skillsText,
        sections,
      }),
    [experienceDrafts, profileSummary, sections, skillsText]
  )
  const matchingSkills = analysis?.presentKeywords?.length ? analysis.presentKeywords : []
  const previewPersonalFields = useMemo<ResumePreviewPersonalField[]>(
    () => personalCustomFields
      .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
      .filter((field) => field.label && field.value),
    [personalCustomFields]
  )
  const livePreviewResume = useMemo(() => {
    const baseName = `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || selectedResume?.full_name || profile?.full_name || ""
    const fullName = [personalInfo.title, baseName].filter(Boolean).join(" ")
    const locationParts = [personalInfo.city, personalInfo.state, personalInfo.country].filter(Boolean)
    const location = locationParts.length ? locationParts.join(", ") : personalInfo.address || selectedResume?.location || ""
    const skillTokens = skillsText
      .split(/[\n,|]/)
      .map((item) => item.replace(/^[^:]+:/, "").trim())
      .filter(Boolean)
      .slice(0, 24)
    const projectBlocks = projectsDraft
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
    const previewProjects = projectBlocks.map((block, index) => {
      const [nameLine, ...descriptionLines] = block.split(/\n/)
      return {
        name: nameLine?.replace(/^[-•]\s*/, "").trim() || `Project ${index + 1}`,
        description: descriptionLines.join("\n").replace(/[•]/g, "").trim() || nameLine || "",
        url: null,
        technologies: skillTokens.slice(0, 5),
      }
    })
    return {
      ...(selectedResume ?? {}),
      id: selectedResume?.id ?? "live-preview",
      name: selectedResume?.name ?? "Live Resume Preview",
      file_name: selectedResume?.file_name ?? "live-preview.pdf",
      full_name: fullName,
      email: personalInfo.email || selectedResume?.email || profile?.email || "",
      phone: personalInfo.phone || selectedResume?.phone || "",
      location,
      portfolio_url: personalInfo.website || selectedResume?.portfolio_url || null,
      summary: profileSummary,
      primary_role: headline || selectedResume?.primary_role || "Software Engineer",
      top_skills: skillTokens,
      skills: skillsTextToSkills(skillsText),
      work_experience: experienceDrafts.map((experienceDraft) => ({
        title: experienceDraft.role,
        company: experienceDraft.company,
        start_date: experienceDraft.from,
        end_date: experienceDraft.current ? null : experienceDraft.to,
        is_current: experienceDraft.current,
        description: "",
        achievements: experienceDraft.description
            .split(/\n/)
            .map((line) => line.replace(/^[-•]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 6),
      })),
      education: educationDrafts.map((educationDraft) => ({
        institution: educationDraft.school,
        degree: educationDraft.degree,
        field: educationDraft.field,
        start_date: educationDraft.from,
        end_date: educationDraft.current ? null : educationDraft.to,
        gpa: null,
      })),
      projects: previewProjects,
    } as Resume
  }, [educationDrafts, experienceDrafts, headline, personalInfo, profile, profileSummary, projectsDraft, selectedResume, skillsText])

  useEffect(() => {
    if (!selectedResume || initializedResumeIdRef.current === selectedResume.id) return
    initializedResumeIdRef.current = selectedResume.id

    const fullName = selectedResume.full_name ?? profile?.full_name ?? ""
    const nameParts = splitName(fullName)
    const locationParts = (selectedResume.location ?? "").split(/,\s*/)

    setPersonalInfo({
      title: selectedResume.primary_role || "",
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      phone: selectedResume.phone || "",
      email: selectedResume.email || profile?.email || "",
      dateOfBirth: "",
      nationality: "",
      address: locationParts[0] ?? selectedResume.location ?? "",
      city: locationParts[0] ?? "",
      state: locationParts[1] ?? "",
      country: locationParts[locationParts.length - 1] ?? "",
      postalCode: "",
      website: selectedResume.portfolio_url || selectedResume.linkedin_url || selectedResume.github_url || "",
    })

    setHeadline(selectedResume.primary_role || "")
    setProfileSummary(selectedResume.summary || "")

    const skills = selectedResume.skills as Record<string, string[]> | null
    if (skills && typeof skills === "object") {
      const buckets = Object.entries(skills)
        .filter(([, values]) => Array.isArray(values) && values.length > 0)
        .map(([key, values]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${(values as string[]).join(", ")}`)
      setSkillsText(buckets.length ? buckets.join("\n") : (selectedResume.top_skills ?? []).join(", "))
    } else {
      setSkillsText((selectedResume.top_skills ?? []).join(", "))
    }

    setExperienceDrafts(
      (selectedResume.work_experience ?? []).map((exp) => ({
        company: exp.company ?? "",
        role: exp.title ?? "",
        city: "",
        country: "",
        from: exp.start_date ?? "",
        to: exp.end_date ?? "",
        current: exp.is_current ?? false,
        description: [
          exp.description ?? "",
          ...(exp.achievements ?? []).map((a) => `• ${a}`),
        ]
          .filter(Boolean)
          .join("\n"),
      }))
    )

    setEducationDrafts(
      (selectedResume.education ?? []).map((edu) => ({
        school: edu.institution ?? "",
        field: edu.field ?? "",
        degree: edu.degree ?? "",
        location: "",
        country: "",
        from: edu.start_date ?? "",
        to: edu.end_date ?? "",
        current: !edu.end_date,
        description: "",
      }))
    )

    const projectText = (selectedResume.projects ?? [])
      .map((p) => `${p.name ?? ""}\n${p.description ?? ""}`.trim())
      .filter(Boolean)
      .join("\n\n")
    setProjectsDraft(projectText)

    setPersonalCustomFields([])
    setIsDirty(false)
    setUndoStack([])
    setRedoStack([])
    lastSnapshotRef.current = null
  }, [selectedResume, profile])

  // isDirty tracks unsaved changes; actual save is triggered by the Save button or before download

  function createEditorSnapshot(): EditorSnapshot {
    return cloneSnapshot({
      sections,
      customSections,
      personalInfo,
      personalCustomFields,
      headline,
      skillsText,
      experienceDrafts,
      educationDrafts,
      projectsDraft,
      publicationDrafts,
      profileSummary,
    })
  }

  function applyEditorSnapshot(snapshot: EditorSnapshot) {
    restoringSnapshotRef.current = true
    setSections(cloneSnapshot(snapshot.sections))
    setCustomSections(cloneSnapshot(snapshot.customSections))
    setPersonalInfo(cloneSnapshot(snapshot.personalInfo))
    setPersonalCustomFields(cloneSnapshot(snapshot.personalCustomFields))
    setHeadline(snapshot.headline)
    setSkillsText(snapshot.skillsText)
    setExperienceDrafts(cloneSnapshot(snapshot.experienceDrafts))
    setEducationDrafts(cloneSnapshot(snapshot.educationDrafts))
    setProjectsDraft(snapshot.projectsDraft)
    setPublicationDrafts(cloneSnapshot(snapshot.publicationDrafts))
    setProfileSummary(snapshot.profileSummary)
    setIsDirty(true)
  }

  useEffect(() => {
    const current = createEditorSnapshot()
    const previous = lastSnapshotRef.current

    if (!previous) {
      lastSnapshotRef.current = current
      return
    }

    if (restoringSnapshotRef.current) {
      restoringSnapshotRef.current = false
      lastSnapshotRef.current = current
      return
    }

    if (JSON.stringify(previous) === JSON.stringify(current)) return

    setUndoStack((stack) => [...stack.slice(-24), previous])
    setRedoStack([])
    lastSnapshotRef.current = current
  }, [
    sections,
    customSections,
    personalInfo,
    personalCustomFields,
    headline,
    skillsText,
    experienceDrafts,
    educationDrafts,
    projectsDraft,
    publicationDrafts,
    profileSummary,
  ])

  function markDirty() {
    setIsDirty(true)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => void saveDraftLatestRef.current(), 3000)
  }

  function getEntries(sectionId: string): StructuredEntry[] {
    return sectionEntries[sectionId] ?? []
  }

  function addEntry(sectionId: string) {
    const entry: StructuredEntry = { id: `${sectionId}-${Date.now()}`, title: "", org: "", date: "", credId: "", description: "" }
    setSectionEntries((prev) => ({ ...prev, [sectionId]: [...(prev[sectionId] ?? []), entry] }))
    markDirty()
  }

  function updateEntry(sectionId: string, entryId: string, patch: Partial<StructuredEntry>) {
    setSectionEntries((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] ?? []).map((e) => e.id === entryId ? { ...e, ...patch } : e),
    }))
    markDirty()
  }

  function removeEntry(sectionId: string, entryId: string) {
    setSectionEntries((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] ?? []).filter((e) => e.id !== entryId),
    }))
    markDirty()
  }

  function experienceIndexFromId(experienceId: string) {
    const m = /^exp-(\d+)$/.exec(experienceId)
    return m ? Number(m[1]) : 0
  }

  function applySkillFix(fix: Extract<TailorFix, { type: "add_skill" }>) {
    setSkillsText((prev) => addSkillToSkillsText(prev, fix.skill))
    setSections((current) =>
      current.map((s) => s.type === "skills" ? { ...s, collapsed: false } : s)
    )
  }

  function applyBulletFix(fix: Extract<TailorFix, { type: "replace_bullet" }>): boolean {
    const i = experienceIndexFromId(fix.experienceId)
    const row = experienceDrafts[i]
    if (!row) return false
    const idx = findBestMatchingLineIndex(row.description, fix.original)
    if (idx < 0) return false
    const lines = row.description.split(/\r?\n/)
    lines[idx] = fix.suggested
    const next = [...experienceDrafts]
    next[i] = { ...row, description: lines.join("\n") }
    setExperienceDrafts(next)
    return true
  }

  function applySummaryFix(fix: Extract<TailorFix, { type: "replace_summary" }>) {
    setProfileSummary(sanitizeTailorSummaryText(fix.suggested))
  }

  const applyTailorFix = useCallback(
    (fix: TailorFix) => {
      if (appliedFixIds.includes(fix.id)) return
      if (fix.requiresConfirmation) {
        const ok = window.confirm(
          `Only apply this if it is true: ${fix.label}. Do you have this experience?`
        )
        if (!ok) return
      }
      setApplyingFixId(fix.id)
      try {
        if (fix.type === "add_skill") {
          applySkillFix(fix)
        } else if (fix.type === "replace_bullet") {
          const matched = applyBulletFix(fix)
          if (!matched) {
            pushToast({ tone: "info", title: "Couldn't locate the original bullet", description: "Edit the experience section directly to apply this change." })
            queueMicrotask(() => setApplyingFixId(null))
            return
          }
        } else {
          applySummaryFix(fix)
        }
        setAppliedFixIds((current) => (current.includes(fix.id) ? current : [...current, fix.id]))
        setTailorStep("applied")
        markDirty()
        if (fix.type === "add_skill") {
          focusEditorSectionFromPreview("skills")
          pushToast({ tone: "success", title: `Skill added: ${fix.skill}`, description: "Visible in the Skills section and resume preview." })
        } else if (fix.type === "replace_bullet") {
          focusEditorSectionFromPreview("experience")
          pushToast({ tone: "success", title: "Bullet updated", description: "Review the change in the preview." })
        } else {
          focusEditorSectionFromPreview("profile")
          pushToast({ tone: "success", title: "Summary updated", description: "Review the change in the resume preview." })
        }
      } finally {
        queueMicrotask(() => setApplyingFixId(null))
      }
    },
    [appliedFixIds, experienceDrafts, focusEditorSectionFromPreview, pushToast]
  )

  const applyAllSafeFixes = useCallback(() => {
    if (!analysis) {
      pushToast({ tone: "info", title: "Run Analyze Match first." })
      return
    }
    const pending = analysis.fixes.filter(
      (f) => !f.requiresConfirmation && !appliedFixIds.includes(f.id)
    )
    if (pending.length === 0) {
      pushToast({ tone: "info", title: "No automatic fixes left to apply." })
      return
    }
    let nextSkills = skillsText
    let nextSummary = profileSummary
    let nextExp = [...experienceDrafts]
    const nextApplied = new Set(appliedFixIds)
    for (const fix of pending) {
      if (fix.type === "add_skill") {
        const after = addSkillToSkillsText(nextSkills, fix.skill)
        if (after !== nextSkills) {
          nextSkills = after
          nextApplied.add(fix.id)
        }
      } else if (fix.type === "replace_summary") {
        nextSummary = sanitizeTailorSummaryText(fix.suggested)
        nextApplied.add(fix.id)
      } else {
        const i = experienceIndexFromId(fix.experienceId)
        if (nextExp[i]) {
          const row = nextExp[i]!
          const lines = row.description.split(/\r?\n/)
          const idx = findBestMatchingLineIndex(row.description, fix.original)
          if (idx >= 0) {
            lines[idx] = fix.suggested
            nextExp[i] = { ...row, description: lines.join("\n") }
            nextApplied.add(fix.id)
          }
          // If no match found, skip this fix — don't append
        }
      }
    }
    const before = appliedFixIds.length
    const applied = nextApplied.size - before
    const skipped = pending.length - applied
    if (applied === 0) {
      pushToast({ tone: "info", title: "No changes applied.", description: skipped > 0 ? `${skipped} bullet fix(es) couldn't locate their original text — apply them individually.` : undefined })
      return
    }
    setSkillsText(nextSkills)
    setProfileSummary(nextSummary)
    setExperienceDrafts(nextExp)
    setAppliedFixIds([...nextApplied])
    setTailorStep("applied")
    markDirty()
    focusEditorSectionFromPreview("profile")
    pushToast({
      tone: "success",
      title: `Applied ${applied} safe fix${applied === 1 ? "" : "es"}`,
      description: skipped > 0 ? `${skipped} bullet fix${skipped === 1 ? "" : "es"} skipped — apply them individually.` : undefined,
    })
  }, [analysis, appliedFixIds, experienceDrafts, focusEditorSectionFromPreview, profileSummary, pushToast, skillsText])

  async function handleAnalyzeTailorMatch() {
    if (!jobDescription.trim()) {
      pushToast({ tone: "info", title: "Paste a job description first." })
      return
    }
    const local = buildLocalTailorAnalysis({
      resume: (livePreviewResume as Resume) ?? null,
      jobDescription,
      skillsText,
      profileSummary,
      experienceDraft: experienceDrafts,
    })
    setAnalysis(local)
    setTailorStep("analyzed")
    setAppliedFixIds([])

    const resumeId = selectedResume?.id
    if (!resumeId) {
      pushToast({
        tone: "success",
        title: "Match analyzed",
        description: "Quick local scan. Link a saved resume in the library to add AI-suggested fixes.",
      })
      return
    }

    setIsTailorRefining(true)
    try {
      const res = await fetch(`/api/resume/${resumeId}/tailor/analyze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: livePreviewResume,
          jobDescription,
          jobTitle: jobTitle || selectedTargetJob?.title,
          company: company || selectedTargetJob?.company,
          currentSkillsText: skillsText,
          currentSummary: profileSummary,
          currentExperience: experienceDrafts,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { analysis?: unknown; error?: string }
      if (res.ok && data.analysis) {
        setAnalysis(normalizeTailorAnalysis(data.analysis))
        setTailorStep("analyzed")
        pushToast({
          tone: "success",
          title: "Analysis updated",
          description: "AI suggestions are merged with the quick scan list below.",
        })
        return
      }
      if (data.error) {
        pushToast({ tone: "error", title: "AI refine failed", description: data.error })
      } else {
        pushToast({
          tone: "info",
          title: "AI refine unavailable",
          description: "Your quick local suggestions are still shown.",
        })
      }
    } catch {
      pushToast({
        tone: "info",
        title: "Could not reach the server",
        description: "Quick local suggestions are still shown.",
      })
    } finally {
      setIsTailorRefining(false)
    }
  }

  function handleUndo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return

    const current = createEditorSnapshot()
    setUndoStack((stack) => stack.slice(0, -1))
    setRedoStack((stack) => [...stack.slice(-24), current])
    applyEditorSnapshot(previous)
  }

  function handleRedo() {
    const next = redoStack[redoStack.length - 1]
    if (!next) return

    const current = createEditorSnapshot()
    setRedoStack((stack) => stack.slice(0, -1))
    setUndoStack((stack) => [...stack.slice(-24), current])
    applyEditorSnapshot(next)
  }

  async function saveDraft(silent = false, createVersion = false) {
    if (!selectedResume?.id) {
      if (!silent) pushToast({ tone: "info", title: "Select a resume to save." })
      return
    }
    setIsSaving(true)
    try {
      const fullName = `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || null
      const location = [personalInfo.city, personalInfo.state, personalInfo.country].filter(Boolean).join(", ") || personalInfo.address || null
      const res = await fetch(`/api/resume/${selectedResume.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: documentName !== "Untitled resume" ? documentName : undefined,
          full_name: fullName,
          email: personalInfo.email || null,
          phone: personalInfo.phone || null,
          location,
          portfolio_url: personalInfo.website || null,
          primary_role: headline || null,
          summary: profileSummary || null,
          work_experience: experienceDrafts.map((draft) => ({
            title: draft.role,
            company: draft.company,
            start_date: draft.from,
            end_date: draft.current ? null : draft.to,
            is_current: draft.current,
            description: draft.description,
            achievements: draft.description
              .split(/\n/)
              .map((line) => line.replace(/^[-•]\s*/, "").trim())
              .filter(Boolean),
          })),
          education: educationDrafts.map((draft) => ({
            institution: draft.school,
            degree: draft.degree,
            field: draft.field,
            start_date: draft.from,
            end_date: draft.current ? null : draft.to,
            gpa: null,
          })),
          skills: skillsTextToSkills(skillsText),
          projects: projectsDraft
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean)
            .map((block, index) => {
              const [nameLine, ...descLines] = block.split(/\n/)
              return {
                name: nameLine?.replace(/^[-•]\s*/, "").trim() || `Project ${index + 1}`,
                description: descLines.join("\n").replace(/[•]/g, "").trim() || nameLine || "",
                url: null,
              }
            }),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Save failed")
      }
      const updated = (await res.json()) as Resume
      upsertResume(updated)
      setIsDirty(false)

      if (createVersion) {
        const snapshot = createResumeSnapshot(livePreviewResume)
        let versionOk = false
        try {
          const vRes = await fetch(`/api/resume/${selectedResume.id}/versions`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${documentName} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
              changes_summary: "Saved from studio",
              snapshot,
            }),
          })
          versionOk = vRes.ok
        } catch {
          versionOk = false
        }
        if (versionOk) {
          window.dispatchEvent(new Event("hireoven:resumes-changed"))
        }
        if (!silent) {
          if (versionOk) {
            pushToast({ tone: "success", title: "Version saved", description: "Resume and version snapshot saved." })
          } else {
            pushToast({ tone: "success", title: "Resume saved", description: "Changes saved — version snapshot could not be created." })
          }
        }
      } else if (!silent) {
        pushToast({ tone: "success", title: "Resume saved", description: "Your changes have been saved." })
      }
    } catch (error) {
      if (!silent) {
        pushToast({
          tone: "error",
          title: "Could not save resume",
          description: error instanceof Error ? error.message : "Please try again.",
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  function updatePersonalInfo(field: keyof typeof personalInfo, value: string) {
    setPersonalInfo((current) => ({ ...current, [field]: value }))
    markDirty()
  }

  function addPersonalCustomField() {
    setPersonalCustomFields((current) => [
      ...current,
      {
        id: `personal-field-${Date.now()}`,
        label: "Custom field",
        value: "",
      },
    ])
    markDirty()
  }

  function updatePersonalCustomField(fieldId: string, changes: Partial<PersonalCustomField>) {
    setPersonalCustomFields((current) =>
      current.map((field) => field.id === fieldId ? { ...field, ...changes } : field)
    )
    markDirty()
  }

  function updateExperience(index: number, field: keyof ExperienceDraft, value: string | boolean) {
    setExperienceDrafts((current) =>
      current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    )
    markDirty()
  }

  function addExperienceDraft() {
    setExperienceDrafts((current) => [
      ...current,
      {
        company: "",
        role: "",
        city: "",
        country: "",
        from: "",
        to: "",
        current: false,
        description: "",
      },
    ])
    markDirty()
  }

  function updateEducation(index: number, field: keyof EducationDraft, value: string | boolean) {
    setEducationDrafts((current) =>
      current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    )
    markDirty()
  }

  function addEducationDraft() {
    setEducationDrafts((current) => [
      ...current,
      {
        school: "",
        field: "",
        degree: "",
        location: "",
        country: "",
        from: "",
        to: "",
        current: false,
        description: "",
      },
    ])
    markDirty()
  }

  function updatePublication(index: number, field: keyof PublicationDraft, value: string) {
    setPublicationDrafts((current) =>
      current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    )
    markDirty()
  }

  function addPublicationDraft() {
    setPublicationDrafts((current) => [
      ...current,
      { title: "", authors: "", publisher: "", url: "", date: "", description: "" },
    ])
    markDirty()
  }

  function removePublicationDraft(index: number) {
    setPublicationDrafts((current) => current.filter((_, i) => i !== index))
    markDirty()
  }

  function addProjectDraft() {
    setProjectsDraft((current) =>
      `${current.trim() ? `${current.trim()}\n\n` : ""}New Project\n• Add the project scope, your role, technologies, and measurable outcome.`
    )
    markDirty()
  }

  function updateCustomSection(sectionId: string, changes: Partial<ResumePreviewCustomSection>) {
    setCustomSections((current) => {
      const existing = current[sectionId] ?? { title: "Custom Section", content: "" }
      return { ...current, [sectionId]: { ...existing, ...changes } }
    })
    markDirty()
  }

  function toggleSectionCollapsed(sectionId: string) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, collapsed: !section.collapsed } : section
      )
    )
    markDirty()
  }

  function hideSection(sectionId: string) {
    // TODO: Persist hidden sections to PATCH /api/resume/:id.
    setSections((current) =>
      current.map((section) => section.id === sectionId ? { ...section, enabled: false } : section)
    )
    markDirty()
  }

  function renameSection(sectionId: string, title: string) {
    setSections((current) =>
      current.map((section) => section.id === sectionId ? { ...section, title } : section)
    )
    setCustomSections((current) => {
      if (!current[sectionId]) return current
      return { ...current, [sectionId]: { ...current[sectionId], title } }
    })
    markDirty()
  }

  function moveSection(fromId: string, toId: string) {
    if (fromId === toId) return

    setSections((current) => {
      const ordered = [...current].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((section) => section.id === fromId)
      const toIndex = ordered.findIndex((section) => section.id === toId)
      if (fromIndex < 0 || toIndex < 0) return current

      const [moved] = ordered.splice(fromIndex, 1)
      ordered.splice(toIndex, 0, moved)
      return ordered.map((section, index) => ({ ...section, order: index }))
    })
    markDirty()
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const fromId = String(event.active.id)
    const toId = event.over?.id ? String(event.over.id) : null
    if (!toId) return
    moveSection(fromId, toId)
  }

  function addSection(type: ResumeSectionType, title: string, premium?: boolean) {
    const existing = sections.find((section) => section.type === type && section.title === title)
    if (existing && !existing.enabled) {
      setSections((current) =>
        current.map((section) =>
          section.id === existing.id
            ? { ...section, enabled: true, collapsed: false, order: current.length }
            : section
        ).map((section, index) => ({ ...section, order: index }))
      )
      markDirty()
      return
    }

    const isDuplicateEnabledSection = Boolean(existing?.enabled)
    const nextType: ResumeSectionType = isDuplicateEnabledSection ? "custom" : type
    const sectionId = isDuplicateEnabledSection || type === "custom" ? `${nextType}-${Date.now()}` : type
    setSections((current) => [
      ...current,
      {
        id: sectionId,
        type: nextType,
        title,
        premium,
        collapsed: false,
        enabled: true,
        order: current.length,
      },
    ])

    if (nextType === "custom" || !["personal", "profile", "skills", "experience", "education", "projects", "publications"].includes(nextType)) {
      setCustomSections((current) => ({
        ...current,
        [sectionId]: {
          title,
          content: `Add ${title.toLowerCase()} details here.`,
        },
      }))
    }
    markDirty()
  }

  async function requestAiSectionText(sectionType: ResumeSectionType, currentText: string, instruction?: string) {
    try {
      // TODO: Persist AI-written section revisions after the user saves the draft.
      const response = await fetch("/api/resume/ai-write", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId: selectedResume?.id,
          sectionType,
          currentText,
          instruction,
          targetRole: headline,
          jobDescription: mode === "tailor" ? jobDescription : undefined,
        }),
      })

      if (response.ok) {
        const body = (await response.json()) as { text?: string }
        if (body.text?.trim()) return body.text.trim()
      }
    } catch {
      // Mock-safe fallback below.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 700))
    const targetRole = headline || "target role"
    if (sectionType === "profile") {
      return `Results-driven ${targetRole} with experience building reliable systems, collaborating across teams, and translating complex requirements into measurable product outcomes. Strong focus on clean implementation, cloud-ready architecture, and truthful impact.`
    }
    if (sectionType === "experience") {
      return splitTextLines(currentText).map((line) => `• Improved ${line.replace(/^[-•]\s*/, "").toLowerCase()} with clearer ownership, technical context, and measurable business impact.`).join("\n")
    }
    if (sectionType === "skills") {
      return currentText
        .split(/[\n,|]/)
        .map((item) => item.replace(/^[^:]+:/, "").trim())
        .filter(Boolean)
        .slice(0, 18)
        .join(", ")
    }
    return currentText.trim()
      ? `${currentText.trim()}\n• Refined by AI for clarity, relevance, and concise resume language.`
      : "Add truthful, role-relevant details with concrete tools, scope, and measurable outcomes."
  }

  async function handleAiWriteSection(sectionId: string, sectionType: ResumeSectionType, currentText: string, instruction?: string) {
    setAiLoadingSectionId(sectionId)
    try {
      const text = await requestAiSectionText(sectionType, currentText, instruction)
      if (sectionType === "profile") setProfileSummary(text)
      else if (sectionType === "skills") setSkillsText(text)
      else if (sectionType === "experience") {
        const index = Number(sectionId.split("-")[1] ?? 0)
        setExperienceDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: text } : item))
      }
      else if (sectionType === "education") {
        const index = Number(sectionId.split("-")[1] ?? 0)
        setEducationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: text } : item))
      }
      else if (sectionType === "projects") setProjectsDraft(text)
      else if (sectionType === "publications") {
        const index = Number(sectionId.split("-")[1] ?? 0)
        setPublicationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: text } : item))
      }
      else updateCustomSection(sectionId, { content: text })
      markDirty()
      pushToast({ tone: "success", title: "AI updated this section." })
    } catch {
      pushToast({ tone: "error", title: "Scout Writer failed." })
    } finally {
      setAiLoadingSectionId(null)
    }
  }

  function handleModeChange(nextMode: StudioMode) {
    setMode(nextMode)
    const resumeParam = selectedId ? `&resumeId=${encodeURIComponent(selectedId)}` : ""
    router.push(`/dashboard/resume/studio?mode=${nextMode}${resumeParam}`, { scroll: false })
  }

  async function handleDownloadResume() {
    if (!selectedResume?.id) {
      pushToast({ tone: "info", title: "Select a resume first." })
      return
    }
    if (isDownloading) return

    if (isDirty) {
      await saveDraft(true)
    }

    setIsDownloading(true)
    try {
      const fileName = `${documentName || selectedResume.name || "resume"}.docx`
      const downloadUrl = `/api/resume/download?resumeId=${encodeURIComponent(selectedResume.id)}`
      const response = await fetch(downloadUrl, { credentials: "include" })
      if (!response.ok) {
        const ct = response.headers.get("content-type") ?? ""
        const fallback = ct.includes("application/json")
          ? (await response.json().catch(() => ({}))) as { error?: string }
          : {}
        throw new Error(fallback.error ?? `Download failed (${response.status})`)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
      pushToast({
        tone: "success",
        title: mode === "tailor" ? "Tailored resume downloaded" : "Resume downloaded",
      })
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Download failed",
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  async function handleCreateTailoredVersion() {
    if (!selectedResume || !jobDescription.trim()) {
      pushToast({ tone: "info", title: "Add a resume and job description first." })
      return
    }
    if (!analysis) {
      pushToast({ tone: "info", title: "Run Analyze Match first." })
      return
    }
    if (appliedFixIds.length === 0) {
      if (
        !window.confirm(
          "You have not applied any recommended fixes. Create a tailored version from the current live resume as shown in the preview?"
        )
      ) {
        return
      }
    }

    setIsTailoring(true)
    try {
      // Flush editor state to DB first so the base resume is current before we duplicate it.
      await saveDraft(true)

      const jt = jobTitle || selectedTargetJob?.title || "Tailored"
      const resumeName = `${jt} Resume`

      // 1. Save a version snapshot for history.
      const snapshot = createResumeSnapshot(livePreviewResume)
      const versionRes = await fetch(`/api/resume/${selectedResume.id}/versions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: resumeName,
          changes_summary: `Tailored for ${jt}. Match score: ${analysis.matchScore}/100. Applied ${appliedFixIds.length} fix(es).`,
          snapshot,
        }),
      })
      if (!versionRes.ok) {
        pushToast({ tone: "error", title: "Could not save version history. Try again." })
        return
      }

      // 2. Duplicate the base resume then patch it with ALL current editor state
      //    (personal info + tailored content) to create the library copy.
      let savedResumeId: string | null = null
      try {
        const dupRes = await fetch(`/api/resume/${selectedResume.id}/duplicate`, {
          method: "POST",
          credentials: "include",
        })
        if (!dupRes.ok) throw new Error("duplicate_failed")

        const dupData = (await dupRes.json().catch(() => ({}))) as { resume?: Resume }
        const dupId = dupData.resume?.id
        if (!dupId) throw new Error("no_duplicate_id")

        const fullName = `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || null
        const location = [personalInfo.city, personalInfo.state, personalInfo.country].filter(Boolean).join(", ") || personalInfo.address || null

        const patchRes = await fetch(`/api/resume/${dupId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: resumeName,
            full_name: fullName,
            email: personalInfo.email || null,
            phone: personalInfo.phone || null,
            location,
            portfolio_url: personalInfo.website || null,
            primary_role: livePreviewResume.primary_role ?? null,
            summary: livePreviewResume.summary ?? null,
            skills: livePreviewResume.skills ?? null,
            work_experience: livePreviewResume.work_experience ?? [],
            education: livePreviewResume.education ?? [],
            projects: livePreviewResume.projects ?? [],
            certifications: livePreviewResume.certifications ?? [],
          }),
        })
        if (!patchRes.ok) throw new Error("patch_failed")

        const patched = (await patchRes.json().catch(() => null)) as Resume | null
        if (patched?.id) {
          savedResumeId = patched.id
          upsertResume(patched)
          window.dispatchEvent(new Event("hireoven:resumes-changed"))
        }
      } catch {
        // Version history already saved — library copy is a bonus. Log and continue.
      }

      await refreshHubData()

      if (savedResumeId) {
        pushToast({
          tone: "success",
          title: `"${resumeName}" saved to your Library`,
          description: "Tailored content, skills, and personal info saved as a new resume.",
          action: { label: "Open Library", href: "/dashboard/resume/library" },
        })
      } else {
        pushToast({
          tone: "success",
          title: "Version saved to history",
          description: "Could not create a Library copy — duplicate it from Version History.",
          action: { label: "View History", href: "/dashboard/resume/versions" },
        })
      }
    } finally {
      setIsTailoring(false)
    }
  }

  function renderEditorSection(section: ResumeSectionState) {
    const commonProps = {
      section,
      onToggleCollapsed: toggleSectionCollapsed,
      onHide: hideSection,
      onRename: renameSection,
    }

    if (section.type === "personal") {
      return (
        <EditableResumeSection key={section.id} {...commonProps}>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* TODO: Wire section updates to PATCH /api/resume/:id. */}
            <div className="sm:col-span-2">
              <TextInput label="Salutation" value={personalInfo.title} placeholder="Mr., Ms., Dr., Prof., etc." onChange={(value) => updatePersonalInfo("title", value)} />
            </div>
            <div className="sm:col-span-2">
              <TextInput label="Headline" value={headline} placeholder="Software Engineer | AI & Cloud Applications | Generative AI" onChange={(value) => { setHeadline(value); markDirty() }} />
            </div>
            <TextInput label="First name" value={personalInfo.firstName} onChange={(value) => updatePersonalInfo("firstName", value)} />
            <TextInput label="Last name" value={personalInfo.lastName} onChange={(value) => updatePersonalInfo("lastName", value)} />
            <TextInput label="Phone number" value={personalInfo.phone} onChange={(value) => updatePersonalInfo("phone", value)} />
            <TextInput label="Email address" value={personalInfo.email} onChange={(value) => updatePersonalInfo("email", value)} />
            <TextInput label="Date of birth" value={personalInfo.dateOfBirth} onChange={(value) => updatePersonalInfo("dateOfBirth", value)} />
            <TextInput label="Nationality" value={personalInfo.nationality} onChange={(value) => updatePersonalInfo("nationality", value)} />
            <TextInput label="Address" value={personalInfo.address} onChange={(value) => updatePersonalInfo("address", value)} />
            <TextInput label="City" value={personalInfo.city} onChange={(value) => updatePersonalInfo("city", value)} />
            <TextInput label="State" value={personalInfo.state} onChange={(value) => updatePersonalInfo("state", value)} />
            <TextInput label="Country" value={personalInfo.country} onChange={(value) => updatePersonalInfo("country", value)} />
            <TextInput label="Postal code" value={personalInfo.postalCode} onChange={(value) => updatePersonalInfo("postalCode", value)} />
            <div className="sm:col-span-2">
              <TextInput label="Web" value={personalInfo.website} placeholder="Portfolio, LinkedIn, GitHub, or personal website" onChange={(value) => updatePersonalInfo("website", value)} />
            </div>
            {personalCustomFields.map((field) => (
              <div key={field.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-2">
                <TextInput label="Custom field label" value={field.label} onChange={(value) => updatePersonalCustomField(field.id, { label: value })} />
                <TextInput label="Custom field value" value={field.value} onChange={(value) => updatePersonalCustomField(field.id, { value })} />
              </div>
            ))}
            <button
              type="button"
              onClick={addPersonalCustomField}
              className="sm:col-span-2 flex h-12 items-center justify-center rounded-xl border border-dashed border-red-300 text-[13px] font-bold text-red-500 transition hover:bg-red-50"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Custom Field
            </button>
          </div>
        </EditableResumeSection>
      )
    }

    if (section.type === "profile") {
      return (
        <EditableResumeSection key={section.id} {...commonProps}>
          <RichTextEditor
            value={profileSummary}
            rows={6}
            onChange={(value) => { setProfileSummary(value); markDirty() }}
            sectionId={section.id}
            sectionType={section.type}
            aiLoading={aiLoadingSectionId === section.id}
            onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
          />
          <button type="button" onClick={() => toggleSectionCollapsed(section.id)} className="mx-auto mt-5 block text-[13px] font-bold text-red-500 hover:text-red-600">
            Hide Additional Fields
          </button>
        </EditableResumeSection>
      )
    }

    if (section.type === "skills") {
      return (
        <EditableResumeSection key={section.id} {...commonProps}>
          <RichTextEditor
            value={skillsText}
            rows={7}
            onChange={(value) => { setSkillsText(value); markDirty() }}
            sectionId={section.id}
            sectionType={section.type}
            aiLoading={aiLoadingSectionId === section.id}
            onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
          />
        </EditableResumeSection>
      )
    }

    if (section.type === "experience") {
      return (
        <EditableResumeSection key={section.id} {...commonProps} addLabel="Add Work Experience" onAdd={addExperienceDraft}>
          <div className="space-y-3">
            {experienceDrafts.map((experienceDraft, index) => {
              const entryId = `experience-${index}`
              return (
                <div key={entryId} className="rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
                    <p className="text-[13px] font-semibold text-slate-700">{experienceDraft.company || `Work Experience ${index + 1}`}</p>
                    <ChevronDown className="h-4 w-4 rotate-180 text-slate-600" />
                  </div>
                  <div className="grid gap-3 p-3 sm:grid-cols-2">
                    <TextInput label="Company" value={experienceDraft.company} onChange={(value) => updateExperience(index, "company", value)} />
                    <TextInput label="Role" value={experienceDraft.role} onChange={(value) => updateExperience(index, "role", value)} />
                    <TextInput label="City" value={experienceDraft.city} onChange={(value) => updateExperience(index, "city", value)} />
                    <TextInput label="Country" value={experienceDraft.country} onChange={(value) => updateExperience(index, "country", value)} />
                    <TextInput label="From" value={experienceDraft.from} onChange={(value) => updateExperience(index, "from", value)} />
                    <TextInput label="To" value={experienceDraft.to} onChange={(value) => updateExperience(index, "to", value)} />
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={experienceDraft.current}
                        onChange={(event) => updateExperience(index, "current", event.target.checked)}
                        className="rounded border-slate-300"
                      />
                      I currently work here
                    </label>
                    <div className="sm:col-span-2">
                      <RichTextEditor
                        label="Description"
                        value={experienceDraft.description}
                        rows={8}
                        onChange={(value) => updateExperience(index, "description", value)}
                        sectionId={entryId}
                        sectionType={section.type}
                        aiLoading={aiLoadingSectionId === entryId}
                        onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            {experienceDrafts.length === 0 && (
              <button type="button" onClick={addExperienceDraft} className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-500 hover:bg-slate-50">
                <Plus className="mr-2 h-4 w-4" />
                Add your first work experience
              </button>
            )}
          </div>
        </EditableResumeSection>
      )
    }

    if (section.type === "education") {
      return (
        <EditableResumeSection key={section.id} {...commonProps} addLabel="Add Education" onAdd={addEducationDraft}>
          <div className="space-y-3">
            {educationDrafts.map((educationDraft, index) => {
              const entryId = `education-${index}`
              return (
                <div key={entryId} className="rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
                    <p className="text-[13px] font-semibold text-slate-700">{educationDraft.school || `Education ${index + 1}`}</p>
                    <ChevronDown className="h-4 w-4 rotate-180 text-slate-600" />
                  </div>
                  <div className="grid gap-3 p-3 sm:grid-cols-2">
                    <TextInput label="School" value={educationDraft.school} onChange={(value) => updateEducation(index, "school", value)} />
                    <TextInput label="Field" value={educationDraft.field} onChange={(value) => updateEducation(index, "field", value)} />
                    <TextInput label="Degree" value={educationDraft.degree} onChange={(value) => updateEducation(index, "degree", value)} />
                    <TextInput label="Location" value={educationDraft.location} onChange={(value) => updateEducation(index, "location", value)} />
                    <TextInput label="Country" value={educationDraft.country} onChange={(value) => updateEducation(index, "country", value)} />
                    <TextInput label="From" value={educationDraft.from} onChange={(value) => updateEducation(index, "from", value)} />
                    <TextInput label="To" value={educationDraft.to} onChange={(value) => updateEducation(index, "to", value)} />
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={educationDraft.current}
                        onChange={(event) => updateEducation(index, "current", event.target.checked)}
                        className="rounded border-slate-300"
                      />
                      I currently study here
                    </label>
                    <div className="sm:col-span-2">
                      <RichTextEditor
                        label="Description"
                        value={educationDraft.description}
                        rows={6}
                        onChange={(value) => updateEducation(index, "description", value)}
                        sectionId={entryId}
                        sectionType={section.type}
                        aiLoading={aiLoadingSectionId === entryId}
                        onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            {educationDrafts.length === 0 && (
              <button type="button" onClick={addEducationDraft} className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-500 hover:bg-slate-50">
                <Plus className="mr-2 h-4 w-4" />
                Add your first education
              </button>
            )}
          </div>
        </EditableResumeSection>
      )
    }

    if (section.type === "projects") {
      return (
        <EditableResumeSection key={section.id} {...commonProps} addLabel="Add Work Project" onAdd={addProjectDraft}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <RichTextEditor
              label="Project Details"
              value={projectsDraft}
              rows={12}
              onChange={(value) => { setProjectsDraft(value); markDirty() }}
              sectionId={section.id}
              sectionType={section.type}
              aiLoading={aiLoadingSectionId === section.id}
              onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
            />
          </div>
        </EditableResumeSection>
      )
    }

    if (section.type === "publications") {
      return (
        <EditableResumeSection key={section.id} {...commonProps} addLabel="Add Publication" onAdd={addPublicationDraft}>
          <div className="space-y-3">
            {publicationDrafts.map((publicationDraft, index) => {
              const entryId = `publications-${index}`
              return (
                <div key={entryId} className="rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
                    <p className="text-[13px] font-semibold text-slate-700">{publicationDraft.title || `Publication ${index + 1}`}</p>
                    <button
                      type="button"
                      onClick={() => removePublicationDraft(index)}
                      className="text-red-400 transition hover:text-red-600"
                      aria-label="Remove publication"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="grid gap-3 p-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <TextInput label="Publication title" value={publicationDraft.title} onChange={(value) => updatePublication(index, "title", value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <TextInput label="Authors" value={publicationDraft.authors} placeholder="e.g. Smith J, Doe A, Johnson B" onChange={(value) => updatePublication(index, "authors", value)} />
                    </div>
                    <TextInput label="Publisher / Journal" value={publicationDraft.publisher} onChange={(value) => updatePublication(index, "publisher", value)} />
                    <TextInput label="Publication date" value={publicationDraft.date} placeholder="e.g. Mar 2024" onChange={(value) => updatePublication(index, "date", value)} />
                    <div className="sm:col-span-2">
                      <TextInput label="URL / DOI / ISBN" value={publicationDraft.url} placeholder="https:// or 10.xxxx/..." onChange={(value) => updatePublication(index, "url", value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <RichTextEditor
                        label="Abstract / Description"
                        value={publicationDraft.description}
                        rows={5}
                        onChange={(value) => updatePublication(index, "description", value)}
                        sectionId={entryId}
                        sectionType={section.type}
                        aiLoading={aiLoadingSectionId === entryId}
                        onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            {publicationDrafts.length === 0 && (
              <button type="button" onClick={addPublicationDraft} className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-500 hover:bg-slate-50">
                <Plus className="mr-2 h-4 w-4" />
                Add your first publication
              </button>
            )}
          </div>
        </EditableResumeSection>
      )
    }

    // ── Structured sections: awards, certificates, achievements ──────────────
    if (section.type === "awards" || section.type === "certificates" || section.type === "achievements") {
      const entries = getEntries(section.id)
      const isCert = section.type === "certificates"
      const isAward = section.type === "awards"
      const entryLabel = isCert ? "Certificate" : isAward ? "Award" : "Achievement"
      return (
        <EditableResumeSection key={section.id} {...commonProps} addLabel={`Add ${entryLabel}`} onAdd={() => addEntry(section.id)}>
          <div className="space-y-3">
            {entries.length === 0 && (
              <button
                type="button"
                onClick={() => addEntry(section.id)}
                className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-500 hover:bg-slate-50"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add your first {entryLabel.toLowerCase()}
              </button>
            )}
            {entries.map((entry, idx) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-slate-700">{entry.title || `${entryLabel} ${idx + 1}`}</p>
                  <button
                    type="button"
                    onClick={() => removeEntry(section.id, entry.id)}
                    className="text-red-400 transition hover:text-red-600"
                    aria-label={`Remove ${entryLabel.toLowerCase()}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  <TextInput
                    label={isCert ? "Certificate name" : isAward ? "Award name" : "Achievement title"}
                    value={entry.title}
                    onChange={(v) => updateEntry(section.id, entry.id, { title: v })}
                  />
                  <TextInput
                    label={isCert ? "Issuing organization" : isAward ? "Awarding body" : "Organization / Context"}
                    value={entry.org}
                    onChange={(v) => updateEntry(section.id, entry.id, { org: v })}
                  />
                  <TextInput
                    label={isCert ? "Issue date" : "Year / Date"}
                    value={entry.date}
                    onChange={(v) => updateEntry(section.id, entry.id, { date: v })}
                  />
                  {isCert && (
                    <TextInput
                      label="Credential ID (optional)"
                      value={entry.credId}
                      onChange={(v) => updateEntry(section.id, entry.id, { credId: v })}
                    />
                  )}
                  <div className={isCert ? "sm:col-span-2" : undefined}>
                    <TextInput
                      label="Description (optional)"
                      value={entry.description}
                      onChange={(v) => updateEntry(section.id, entry.id, { description: v })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </EditableResumeSection>
      )
    }

    const custom = customSections[section.id] ?? { title: section.title, content: "" }
    return (
      <EditableResumeSection key={section.id} {...commonProps}>
        <div className="grid gap-3">
          <TextInput label="Section title" value={section.title} onChange={(value) => renameSection(section.id, value)} />
          <RichTextEditor
            label="Content"
            value={custom.content}
            rows={6}
            onChange={(value) => updateCustomSection(section.id, { content: value })}
            sectionId={section.id}
            sectionType={section.type}
            aiLoading={aiLoadingSectionId === section.id}
            onAiWrite={(text, sectionId, sectionType) => void handleAiWriteSection(sectionId, sectionType, text)}
          />
        </div>
      </EditableResumeSection>
    )
  }

  // Always keep ref current so the auto-save timer calls the latest saveDraft
  saveDraftLatestRef.current = () => saveDraft(true)

  return (
    <main className="min-h-[calc(100vh-8.5rem)] bg-[#FAFBFF]">
      <div className="w-full max-w-none space-y-4 px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-slate-950">Resume Studio</h1>
            <p className="mt-1 text-[13px] text-slate-500">Edit, preview, and tailor your resume.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Download — always visible */}
            <button
              type="button"
              onClick={() => void handleDownloadResume()}
              disabled={!selectedResume?.id || isDownloading || isSaving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading…" : "Download"}
            </button>

            {/* Preview mode: Save + Version — tailor mode has its own save in the workflow */}
            {mode === "preview" && (
              <button
                type="button"
                onClick={() => void saveDraft(false, true)}
                disabled={!selectedResume?.id || isSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isSaving ? "Saving…" : "Save Version"}
              </button>
            )}
          </div>
        </header>

        <ModeSwitcher mode={mode} onModeChange={handleModeChange} />

        {mode === "preview" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(620px,1.05fr)]">
            <section className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={undoStack.length === 0}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Undo"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={redoStack.length === 0}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Redo"
                    >
                      <Redo2 className="h-4 w-4" />
                    </button>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-bold transition-all duration-300",
                      isSaving
                        ? "animate-pulse bg-indigo-50 text-[#5B4DFF] shadow-[0_0_0_4px_rgba(91,77,255,0.08)] ring-1 ring-[#5B4DFF]/20"
                        : isDirty
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    )}>
                      <Cloud className={cn("h-3.5 w-3.5", isSaving && "animate-bounce")} />
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {isSaving ? "Saving..." : isDirty ? "Unsaved changes" : "Saved"}
                    </span>
                  </div>
                  <div
                    className="flex min-w-0 max-w-full flex-1 items-baseline justify-end gap-1.5 text-[13px] font-semibold text-slate-700 sm:max-w-md"
                    title={documentName}
                  >
                    <span className="shrink-0">Document:</span>
                    <span className="min-w-0 truncate text-slate-950">{documentName}</span>
                  </div>
                </div>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[14px] font-bold text-slate-950">Section Analysis</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {sectionChecks.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.label}</p>
                      <p
                        className={cn(
                          "mt-1 text-[12px] font-semibold",
                          item.tone === "good"
                            ? "text-emerald-700"
                            : item.tone === "neutral"
                              ? "text-slate-500"
                              : "text-orange-600"
                        )}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                <SortableContext items={orderedSections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-4">
                    {orderedSections.map((section) => renderEditorSection(section))}
                  </div>
                </SortableContext>
              </DndContext>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="mb-4 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-400">Add a section</p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {ADD_SECTIONS.map(({ type, label, icon: Icon, desc }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => addSection(type, label)}
                      className="group flex flex-col items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-left transition hover:border-orange-300/70 hover:bg-orange-50/20"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 transition group-hover:ring-orange-300">
                        <Icon className="h-4 w-4 text-slate-400 transition group-hover:text-orange-500" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-slate-800">{label}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </section>

            <StickyResumePreview
              title="Live Resume Preview"
              resume={livePreviewResume}
              profile={profile}
              sections={orderedSections}
              customSections={previewCustomSections}
              personalFields={previewPersonalFields}
              onPreviewSectionNavigate={focusEditorSectionFromPreview}
              onDownload={() => void handleDownloadResume()}
            />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)] xl:grid-cols-[minmax(0,0.8fr)_minmax(320px,0.7fr)_minmax(560px,1fr)]">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <ResumeSelect resumes={resumes} selectedId={selectedResume?.id ?? null} onChange={setSelectedId} />

              <div>
                <FieldLabel>Job source</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "saved" as const, label: "Saved Job" },
                    { id: "paste" as const, label: "Paste Description" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setJobSource(item.id)}
                      className={cn(
                        "h-10 rounded-lg border text-[12px] font-bold transition",
                        jobSource === item.id ? "border-[#5B4DFF] bg-indigo-50 text-[#5B4DFF]" : "border-slate-200 bg-white text-slate-600"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {jobSource === "saved" && (
                <div>
                  <FieldLabel>Select saved job</FieldLabel>
                  <select
                    value={selectedTargetJobId}
                    onChange={(event) => {
                      const value = event.target.value
                      setSelectedTargetJobId(value)
                      const job = hubData.targetJobs.find((item) => item.id === value)
                      setJobTitle(job?.title ?? "")
                      setCompany(job?.company ?? "")
                      if (job?.description) setJobDescription(job.description)
                    }}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[#5B4DFF]"
                  >
                    <option value="paste">Choose a saved job</option>
                    {hubData.targetJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}
                        {job.company ? ` at ${job.company}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <FieldLabel>Job Title</FieldLabel>
                  <input
                    value={jobTitle}
                    onChange={(event) => setJobTitle(event.target.value)}
                    placeholder="Backend Engineer"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[#5B4DFF]"
                  />
                </label>
                <label>
                  <FieldLabel>Company</FieldLabel>
                  <input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    placeholder="Company"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[#5B4DFF]"
                  />
                </label>
              </div>

              <div>
                <FieldLabel>Job Description</FieldLabel>
                <textarea
                  rows={7}
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="Paste the full job description..."
                  className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#5B4DFF]"
                />
              </div>

              <details className="group rounded-xl border border-slate-200 bg-slate-50/90">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 [&::-webkit-details-marker]:hidden sm:px-3.5">
                  <span>How this flow works</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden />
                </summary>
                <ol className="list-decimal space-y-1.5 border-t border-slate-200/80 px-3.5 py-2.5 pl-7 text-[12px] leading-relaxed text-slate-600 sm:px-3.5">
                  <li>
                    <span className="font-semibold text-slate-800">Analyze Match</span> compares the job to your live resume in this workspace.
                  </li>
                  <li>
                    Review <span className="font-semibold text-slate-800">Recommended Fixes</span> in the next column—apply skills, bullets, or summary updates that are truthful.
                  </li>
                  <li>Switch to the Preview tab anytime to edit sections directly, then re-run match.</li>
                  <li>
                    <span className="font-semibold text-slate-800">Create Tailored Version</span> saves a snapshot to your version history.
                  </li>
                </ol>
              </details>

              {/* Single progressive CTA: Analyze → Save Tailored Version */}
              {appliedFixIds.length > 0 ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateTailoredVersion()}
                    disabled={isTailoring || !selectedResume || !jobDescription.trim() || !analysis}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#5B4DFF] text-[12.5px] font-semibold text-white transition hover:bg-[#493EE6] disabled:opacity-60"
                  >
                    {isTailoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {isTailoring ? "Saving tailored version…" : `Save Tailored Version (${appliedFixIds.length} fix${appliedFixIds.length === 1 ? "" : "es"} applied)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAnalyzeTailorMatch()}
                    disabled={isTailorRefining || isTailoring || !jobDescription.trim()}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {isTailorRefining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
                    {isTailorRefining ? "Refining…" : "Re-analyze"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleAnalyzeTailorMatch()}
                  disabled={isTailorRefining || isTailoring || !jobDescription.trim()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#5B4DFF] bg-indigo-50 text-[12.5px] font-bold text-[#5B4DFF] transition hover:bg-indigo-100 disabled:opacity-60"
                >
                  {isTailorRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                  {isTailorRefining ? "Refining with AI…" : analysis ? "Re-analyze" : "Analyze Match"}
                </button>
              )}
            </section>

            <div className="flex min-h-0 max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3 sm:space-y-3 sm:p-4">
                <TailorMatchInsightPanel analysis={analysis} matchingSkills={matchingSkills} />
                {analysis ? (
                  <p className="text-[11px] text-slate-500">
                    Only apply suggestions that accurately reflect your real experience.
                  </p>
                ) : null}
                <TailorRecommendedFixesPanel
                  analysis={analysis}
                  appliedIds={appliedFixIds}
                  applyingId={applyingFixId}
                  onApply={applyTailorFix}
                  onApplyAllSafe={applyAllSafeFixes}
                  disabled={isTailoring}
                />
                <p className="shrink-0 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  Only apply suggestions that are true. Do not add skills or experience you don&apos;t have.
                </p>
              </div>
            </div>

            <div className="hidden xl:contents">
              <StickyResumePreview
                title="Tailored Resume Preview"
                badge="Draft tailored version"
                resume={livePreviewResume}
                profile={profile}
                sections={orderedSections}
                customSections={previewCustomSections}
                personalFields={previewPersonalFields}
                onPreviewSectionNavigate={focusEditorSectionFromPreview}
                onDownload={() => void handleDownloadResume()}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
