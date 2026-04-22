"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  ArrowLeft,
  Zap,
  ClipboardList,
  FileCheck,
  Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { devError } from "@/lib/client-dev-log"

// ── Types ──────────────────────────────────────────────────────────────────

type StepId = 1 | 2 | 3 | 4 | 5

type ProfileCheck = {
  ok: boolean
  completionPct: number
  missingRequired: string[]
  missingOptional: string[]
}

type Resume = {
  id: string
  title: string
  is_primary: boolean
}

type FillResult = {
  script: string
  atsType: string
  estimatedFields: number
  applyUrl: string
  jobTitle: string
  companyName: string
}

// ── Step indicator ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Pre-flight", icon: CheckCircle2 },
  { id: 2, label: "Resume", icon: FileCheck },
  { id: 3, label: "Script", icon: Zap },
  { id: 4, label: "Instructions", icon: ClipboardList },
  { id: 5, label: "Log", icon: Send },
] as const

function StepIndicator({ current }: { current: StepId }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done = step.id < current
        const active = step.id === current
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  done
                    ? "bg-[#FF5C18] text-white"
                    : active
                    ? "bg-[#FFF1E8] text-[#9A3412] ring-2 ring-[#FF5C18]"
                    : "bg-gray-100 text-gray-400",
                ].join(" ")}
              >
                {done ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </div>
              <span
                className={[
                  "text-[10px] font-medium",
                  active ? "text-[#9A3412]" : done ? "text-[#FF5C18]" : "text-gray-400",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={[
                  "h-px w-10 mb-4 mx-1",
                  step.id < current ? "bg-[#FF5C18]" : "bg-gray-200",
                ].join(" ")}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1 - Pre-flight check ──────────────────────────────────────────────

function PreflightStep({
  check,
  loading,
  onNext,
}: {
  check: ProfileCheck | null
  loading: boolean
  onNext: () => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-[#FF5C18]" />
      </div>
    )
  }

  if (!check) return null

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Profile check</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Verifying your autofill profile is ready to use.
        </p>
      </div>

      {/* Completion bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 font-medium">Profile completeness</span>
          <span
            className={[
              "font-semibold",
              check.completionPct >= 70
                ? "text-green-600"
                : check.completionPct >= 40
                ? "text-amber-600"
                : "text-red-600",
            ].join(" ")}
          >
            {check.completionPct}%
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={[
              "h-full rounded-full transition-all",
              check.completionPct >= 70
                ? "bg-green-500"
                : check.completionPct >= 40
                ? "bg-amber-500"
                : "bg-red-500",
            ].join(" ")}
            style={{ width: `${check.completionPct}%` }}
          />
        </div>
      </div>

      {/* Status rows */}
      <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        <CheckRow
          ok
          label="Autofill profile exists"
          detail="Your profile was found."
        />
        <CheckRow
          ok={check.missingRequired.length === 0}
          label="Required fields filled"
          detail={
            check.missingRequired.length === 0
              ? "All required fields are present."
              : `Missing: ${check.missingRequired.join(", ")}`
          }
        />
        <CheckRow
          ok={check.completionPct >= 70}
          label="Profile completeness ≥ 70%"
          detail={
            check.completionPct >= 70
              ? "Profile is sufficiently complete."
              : "Fill in more fields for better autofill coverage."
          }
          warn={check.completionPct >= 40 && check.completionPct < 70}
        />
      </div>

      {check.missingOptional.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Optional fields missing</p>
          <p className="text-amber-700">
            Adding these will improve fill coverage:{" "}
            {check.missingOptional.slice(0, 5).join(", ")}
            {check.missingOptional.length > 5
              ? ` and ${check.missingOptional.length - 5} more`
              : ""}
          </p>
          <Link
            href="/dashboard/autofill"
            className="inline-block mt-2 text-[#FF5C18] hover:underline font-medium"
          >
            Complete profile →
          </Link>
        </div>
      )}

      {!check.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Profile needs attention</p>
          <p className="mt-0.5 text-red-700">
            Set up your autofill profile before running autofill.
          </p>
          <Link
            href="/dashboard/autofill"
            className="inline-block mt-2 text-[#FF5C18] hover:underline font-medium"
          >
            Set up profile →
          </Link>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          onClick={onNext}
          disabled={!check.ok}
          className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white gap-2"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

function CheckRow({
  ok,
  label,
  detail,
  warn = false,
}: {
  ok: boolean
  label: string
  detail: string
  warn?: boolean
}) {
  const Icon = ok ? CheckCircle2 : warn ? AlertCircle : XCircle
  const color = ok
    ? "text-green-500"
    : warn
    ? "text-amber-500"
    : "text-red-500"

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
      </div>
    </div>
  )
}

// ── Step 2 - Resume selection ──────────────────────────────────────────────

function ResumeStep({
  resumes,
  selectedId,
  onSelect,
  onNext,
  onBack,
}: {
  resumes: Resume[]
  selectedId: string
  onSelect: (id: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Choose a resume</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Select which resume to upload in the file input (if one exists on the form).
          The autofill script uses your saved profile data - not the resume file.
        </p>
      </div>

      <div className="space-y-2">
        {resumes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">No resumes found.</p>
            <Link
              href="/dashboard/resume"
              className="text-[#FF5C18] text-sm hover:underline mt-1 inline-block"
            >
              Upload a resume →
            </Link>
          </div>
        ) : (
          resumes.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={[
                "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors",
                selectedId === r.id
                  ? "border-[#FF5C18] bg-[#FFF7F2]"
                  : "border-gray-200 hover:border-gray-300 bg-white",
              ].join(" ")}
            >
              <div className="flex items-center gap-3">
                <div
                  className={[
                    "w-4 h-4 rounded-full border-2 flex-shrink-0",
                    selectedId === r.id
                      ? "border-[#FF5C18] bg-[#FF5C18]"
                      : "border-gray-300",
                  ].join(" ")}
                >
                  {selectedId === r.id && (
                    <div className="w-full h-full rounded-full bg-white scale-50" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-800">{r.title}</span>
              </div>
              {r.is_primary && (
                <Badge variant="secondary" className="text-xs">
                  Primary
                </Badge>
              )}
            </button>
          ))
        )}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-gray-600">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          onClick={onNext}
          className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white gap-2"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Step 3 - Script ────────────────────────────────────────────────────────

function ScriptStep({
  fillResult,
  loading,
  jobTitle,
  companyName,
  applyUrl,
  onNext,
  onBack,
}: {
  fillResult: FillResult | null
  loading: boolean
  jobTitle: string
  companyName: string
  applyUrl: string
  onNext: () => void
  onBack: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!fillResult) return
    await navigator.clipboard.writeText(fillResult.script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [fillResult])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-[#FF5C18]" />
        <p className="text-sm text-gray-500">Generating fill script…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Your fill script</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Copy this script. In your browser, open the application page, then open DevTools
          (F12 / ⌘⌥I), go to the Console tab, paste, and press Enter.
        </p>
      </div>

      {fillResult && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-gray-600">
              <Zap className="w-4 h-4 text-[#FF5C18]" />
              <span>
                <span className="font-semibold text-gray-800">~{fillResult.estimatedFields}</span> fields estimated
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <Badge variant="outline" className="text-xs capitalize">
                {fillResult.atsType}
              </Badge>
            </div>
          </div>

          <div className="relative rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-100">
              <span className="text-xs font-mono text-gray-500">fill-script.js</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-[#FF5C18] hover:text-[#9A3412] font-medium"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-gray-700 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
              {fillResult.script.slice(0, 600)}
              {fillResult.script.length > 600 && (
                <span className="text-gray-400">
                  {"\n"}… {fillResult.script.length - 600} more characters
                </span>
              )}
            </pre>
          </div>

          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[#FF5C18] hover:underline font-medium"
            >
              <ExternalLink className="w-4 h-4" />
              Open {companyName || "application"} page
            </a>
          )}

          <div className="rounded-xl border border-[#FFD2B8] bg-[#FFF7F2] p-4 text-sm text-[#7C2D12]">
            <p className="font-semibold mb-1">Quick steps</p>
            <ol className="list-decimal list-inside space-y-1 text-[#9A3412]">
              <li>Open the job application page (link above)</li>
              <li>Open DevTools: <kbd className="bg-[#FFF1E8] px-1 rounded text-xs">F12</kbd> or <kbd className="bg-[#FFF1E8] px-1 rounded text-xs">⌘⌥I</kbd></li>
              <li>Click the <strong>Console</strong> tab</li>
              <li>Paste the script and press <kbd className="bg-[#FFF1E8] px-1 rounded text-xs">Enter</kbd></li>
              <li>Review every filled field before submitting</li>
            </ol>
          </div>
        </>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-gray-600">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          onClick={onNext}
          className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white gap-2"
        >
          I ran the script <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Step 4 - Instructions ──────────────────────────────────────────────────

function InstructionsStep({
  atsType,
  onNext,
  onBack,
}: {
  atsType: string
  onNext: () => void
  onBack: () => void
}) {
  const tips: Record<string, string[]> = {
    greenhouse: [
      "Greenhouse renders some dropdowns after page load - scroll down to trigger them before re-running if needed.",
      "File upload fields (resume, cover letter) must be filled manually.",
      "EEOC/diversity questions at the bottom are filled if you enabled that in your profile.",
    ],
    lever: [
      "Lever's URL fields use custom names - check that LinkedIn/GitHub were filled correctly.",
      "Some Lever forms use a multi-step layout - run the script on each step.",
      "The cover letter textarea is targeted automatically if it matches the label.",
    ],
    ashby: [
      "Ashby uses React-rendered forms with dynamic IDs - the script targets by aria-label.",
      "If fields appear empty after running, click on a field and try pasting manually.",
      "Ashby's file upload is not autofilled - attach your resume manually.",
    ],
    generic: [
      "Review every filled field carefully - the generic matcher works by field label text.",
      "Fields that couldn't be matched will show in the overlay summary.",
      "File upload fields always need manual input.",
    ],
  }

  const activeTips = tips[atsType] ?? tips.generic

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {atsType !== "generic" ? `${atsType.charAt(0).toUpperCase() + atsType.slice(1)} tips` : "Review tips"}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          A few things to check before submitting.
        </p>
      </div>

      <ul className="space-y-2">
        {activeTips.map((tip, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
            <div className="w-5 h-5 rounded-full bg-[#FFF1E8] text-[#9A3412] flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              {i + 1}
            </div>
            {tip}
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">Always review before submitting</p>
        <p className="mt-0.5 text-amber-700">
          The autofill script is a starting point. Check every field, especially
          salary, visa sponsorship, and custom essay questions.
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-gray-600">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          onClick={onNext}
          className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white gap-2"
        >
          I submitted the application <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Step 5 - Log application ───────────────────────────────────────────────

function LogStep({
  jobTitle,
  companyName,
  fillResult,
  onLog,
  logging,
  logged,
}: {
  jobTitle: string
  companyName: string
  fillResult: FillResult | null
  onLog: (fieldsTotal: number, fieldsFilled: number) => void
  logging: boolean
  logged: boolean
}) {
  const [fieldsFilled, setFieldsFilled] = useState(
    fillResult?.estimatedFields ?? 0
  )
  const [fieldsTotal, setFieldsTotal] = useState(
    fillResult?.estimatedFields ?? 0
  )

  if (logged) {
    return (
      <div className="flex flex-col items-center py-12 gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-green-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Application logged!</h2>
          <p className="text-sm text-gray-500 mt-1">
            {companyName} - {jobTitle} has been added to your autofill history.
          </p>
        </div>
        <div className="flex gap-3 mt-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/applications">View tracker</Link>
          </Button>
          <Button className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Log this application</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Record how many fields were filled so you can track your autofill coverage over time.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 p-4 bg-gray-50 space-y-1">
        <p className="text-sm font-medium text-gray-800">{jobTitle || "Job"}</p>
        <p className="text-xs text-gray-500">{companyName}</p>
      </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
          <label className="text-sm text-gray-700">Fields filled</label>
          <input
            type="number"
            min={0}
            value={fieldsFilled}
            onChange={(e) => setFieldsFilled(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5C18]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm text-gray-700">Total fields on form</label>
          <input
            type="number"
            min={1}
            value={fieldsTotal}
            onChange={(e) => setFieldsTotal(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF5C18]"
          />
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button
          variant="outline"
          asChild
        >
          <Link href="/dashboard">Skip, back to dashboard</Link>
        </Button>
        <Button
          onClick={() => onLog(fieldsTotal, fieldsFilled)}
          disabled={logging}
          className="bg-[#FF5C18] hover:bg-[#E14F0E] text-white gap-2"
        >
          {logging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Log application
        </Button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AutofillFillPage() {
  const { jobId } = useParams<{ jobId: string }>()

  const [step, setStep] = useState<StepId>(1)

  // Step 1
  const [profileCheck, setProfileCheck] = useState<ProfileCheck | null>(null)
  const [checkLoading, setCheckLoading] = useState(true)

  // Step 2
  const [resumes, setResumes] = useState<Resume[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState("")

  // Step 3
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [scriptLoading, setScriptLoading] = useState(false)

  // Step 5
  const [logging, setLogging] = useState(false)
  const [logged, setLogged] = useState(false)

  // ── Load profile check on mount ──────────────────────────────────────────
  useEffect(() => {
    async function check() {
      setCheckLoading(true)
      try {
        const res = await fetch("/api/autofill/profile")
        if (!res.ok) {
          setProfileCheck({ ok: false, completionPct: 0, missingRequired: ["No profile found"], missingOptional: [] })
          return
        }
        const data = await res.json()
        const profile = data.profile

        const required = ["first_name", "last_name", "email"] as const
        const optional = ["phone", "city", "state", "linkedin_url", "years_of_experience", "work_authorization", "salary_expectation_min"] as const
        const missingRequired = required.filter((k) => !profile?.[k])
        const missingOptional = optional.filter((k) => !profile?.[k]).map((k) => k.replace(/_/g, " "))

        setProfileCheck({
          ok: missingRequired.length === 0,
          completionPct: data.completionPct ?? data.completion ?? 0,
          missingRequired: missingRequired.map((k) => k.replace(/_/g, " ")),
          missingOptional,
        })
      } catch {
        setProfileCheck({ ok: false, completionPct: 0, missingRequired: ["Failed to load profile"], missingOptional: [] })
      } finally {
        setCheckLoading(false)
      }
    }
    void check()
  }, [])

  // ── Load resumes on mount ─────────────────────────────────────────────────
  useEffect(() => {
    async function loadResumes() {
      try {
        const res = await fetch("/api/resume")
        if (!res.ok) return
        const data = await res.json()
        const list: Resume[] = (Array.isArray(data) ? data : data.resumes ?? []).map((r: any) => ({
          id: r.id,
          title: r.name ?? r.file_name ?? "Untitled",
          is_primary: r.is_primary ?? false,
        }))
        setResumes(list)
        const primary = list.find((r) => r.is_primary)
        if (primary) setSelectedResumeId(primary.id)
        else if (list.length > 0) setSelectedResumeId(list[0].id)
      } catch {
        // resumes optional
      }
    }
    void loadResumes()
  }, [])

  // ── Generate fill script ──────────────────────────────────────────────────
  const generateScript = useCallback(async () => {
    setScriptLoading(true)
    try {
      const res = await fetch("/api/autofill/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) throw new Error("Failed to generate script")
      const data = await res.json()
      setFillResult(data)
    } catch (err) {
      devError(err)
    } finally {
      setScriptLoading(false)
    }
  }, [jobId])

  const advanceTo = useCallback(
    (next: StepId) => {
      if (next === 3 && !fillResult) {
        void generateScript()
      }
      setStep(next)
    },
    [fillResult, generateScript]
  )

  // ── Log application ───────────────────────────────────────────────────────
  const handleLog = useCallback(
    async (fieldsTotal: number, fieldsFilled: number) => {
      setLogging(true)
      try {
        await fetch("/api/autofill/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: jobId,
            resume_id: selectedResumeId || null,
            company_name: fillResult?.companyName ?? "",
            job_title: fillResult?.jobTitle ?? "",
            apply_url: fillResult?.applyUrl ?? "",
            ats_type: fillResult?.atsType ?? "generic",
            fields_filled: fieldsFilled,
            fields_total: fieldsTotal,
          }),
        })
        setLogged(true)
      } catch (err) {
        devError(err)
      } finally {
        setLogging(false)
      }
    },
    [fillResult, jobId, selectedResumeId]
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Autofill application</h1>
          {fillResult && (
            <p className="text-sm text-gray-500 mt-1">
              {fillResult.jobTitle} at {fillResult.companyName}
            </p>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex justify-center mb-8">
          <StepIndicator current={step} />
        </div>

        {/* Step content */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          {step === 1 && (
            <PreflightStep
              check={profileCheck}
              loading={checkLoading}
              onNext={() => advanceTo(2)}
            />
          )}
          {step === 2 && (
            <ResumeStep
              resumes={resumes}
              selectedId={selectedResumeId}
              onSelect={setSelectedResumeId}
              onNext={() => advanceTo(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <ScriptStep
              fillResult={fillResult}
              loading={scriptLoading}
              jobTitle={fillResult?.jobTitle ?? ""}
              companyName={fillResult?.companyName ?? ""}
              applyUrl={fillResult?.applyUrl ?? ""}
              onNext={() => advanceTo(4)}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <InstructionsStep
              atsType={fillResult?.atsType ?? "generic"}
              onNext={() => advanceTo(5)}
              onBack={() => setStep(3)}
            />
          )}
          {step === 5 && (
            <LogStep
              jobTitle={fillResult?.jobTitle ?? ""}
              companyName={fillResult?.companyName ?? ""}
              fillResult={fillResult}
              onLog={handleLog}
              logging={logging}
              logged={logged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
