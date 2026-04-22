"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react"
import CoverLetterDocument from "@/components/cover-letter/CoverLetterDocument"
import SponsorshipHelper from "@/components/cover-letter/SponsorshipHelper"
import ToneSelector from "@/components/cover-letter/ToneSelector"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useCoverLetter } from "@/lib/hooks/useCoverLetter"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { Company, CoverLetterLength, CoverLetterStyle, Job, Profile } from "@/types"

type JobWithCompany = Job & { company: Company }

// ── Generating animation ────────────────────────────────────────────────────

function GeneratingAnimation({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-8 py-16">
      {/* Animated document lines */}
      <div className="relative w-48">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {[1, 2, 3, 4, 5].map((line) => (
            <div
              key={line}
              className="mb-3 h-2.5 rounded-full bg-gray-100"
              style={{
                width: line === 1 ? "40%" : line === 5 ? "60%" : `${70 + (line % 3) * 10}%`,
                animationDelay: `${line * 0.3}s`,
                animation: "pulse-line 1.8s ease-in-out infinite",
              }}
            />
          ))}
          <div className="mt-4 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-[#0369A1]" />
            <div className="h-2 w-24 animate-pulse rounded-full bg-[#BFDBFE]" />
          </div>
        </div>
        {/* Pen cursor */}
        <div
          className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#0369A1] shadow-lg"
          style={{ animation: "float 2s ease-in-out infinite" }}
        >
          <FileText className="h-3.5 w-3.5 text-white" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-base font-semibold text-gray-900">{message}</p>
        <p className="mt-1 text-sm text-gray-400">This takes about 10–15 seconds</p>
      </div>

      <style>{`
        @keyframes pulse-line {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}

// ── Options panel ───────────────────────────────────────────────────────────

type LengthOption = { value: CoverLetterLength; label: string; desc: string }
type StyleOption = { value: CoverLetterStyle; label: string; desc: string }

const LENGTHS: LengthOption[] = [
  { value: "short", label: "Short", desc: "150–200w" },
  { value: "medium", label: "Medium", desc: "250–350w" },
  { value: "long", label: "Long", desc: "400–500w" },
]

const STYLES: StyleOption[] = [
  { value: "story", label: "Story", desc: "Narrative opener" },
  { value: "skills_focused", label: "Skills-focused", desc: "Match skills to role" },
  { value: "achievement_focused", label: "Achievement-focused", desc: "Lead with results" },
]

// ── Variant card ─────────────────────────────────────────────────────────────

function VariantCard({
  letter,
  onSelect,
}: {
  letter: import("@/types").CoverLetter
  onSelect: () => void
}) {
  const preview = letter.body.slice(0, 200)
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
          {letter.tone}
        </span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
          {letter.style.replace("_", " ")}
        </span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
          {letter.word_count}w
        </span>
      </div>
      <p className="text-sm leading-6 text-gray-600 line-clamp-4">{preview}…</p>
      <button
        type="button"
        onClick={onSelect}
        className="mt-4 w-full rounded-xl bg-[#0369A1] py-2 text-sm font-semibold text-white transition hover:bg-[#075985]"
      >
        Use this version
      </button>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function CoverLetterPage() {
  const params = useParams<{ jobId: string }>()
  const searchParams = useSearchParams()
  const jobId = params.jobId
  const { primaryResume } = useResumeContext()

  const [job, setJob] = useState<JobWithCompany | null>(null)
  const [jobLoading, setJobLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

  const {
    coverLetter,
    isGenerating,
    isRegenerating,
    isGeneratingVariants,
    generatingMessage,
    options,
    updateOptions,
    generate,
    regenerateParagraph,
    updateBody,
    copyToClipboard,
    downloadTxt,
    downloadDocx,
    isCopied,
    error,
    variants,
    generateVariants,
    selectVariant,
    toggleFavorite,
  } = useCoverLetter(jobId)

  // Load job and profile
  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [jobRes, profileRes] = await Promise.all([
        (supabase.from("jobs").select("*, company:companies(*)").eq("id", jobId).single() as any),
        supabase.from("profiles").select("*").single(),
      ])
      setJob((jobRes.data as JobWithCompany | null) ?? null)
      setProfile((profileRes.data as Profile | null) ?? null)
      setJobLoading(false)
    }
    void load()
  }, [jobId])

  // Pre-fill sponsorship from query param (?mentionSponsorship=true)
  useEffect(() => {
    if (searchParams.get("mentionSponsorship") === "true") {
      updateOptions({ mentionSponsorship: true })
    }
  }, [searchParams, updateOptions])

  const hasResume = Boolean(primaryResume?.parse_status === "complete")
  const showSponsorshipSection = Boolean(profile?.needs_sponsorship)

  return (
    <main className="app-page">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Back */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to feed
          </Link>
          {job && (
            <>
              <span className="text-gray-300">/</span>
              <Link
                href={`/dashboard/resume/analyze/${jobId}`}
                className="text-sm font-medium text-gray-500 transition hover:text-gray-900"
              >
                Match analysis
              </Link>
            </>
          )}
        </div>

        {/* Job header */}
        {job && (
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
            <div className="flex items-start gap-4">
              {job.company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={job.company.logo_url}
                  alt={job.company.name}
                  className="h-12 w-12 rounded-2xl border border-gray-200 object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E0F2FE] text-lg font-bold text-[#0C4A6E]">
                  {job.company.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  {job.company.name}
                </p>
                <h1 className="mt-0.5 text-xl font-semibold text-gray-900">{job.title}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Cover letter generator
                </p>
              </div>
            </div>
          </div>
        )}
        {jobLoading && (
          <div className="h-24 animate-pulse rounded-[32px] bg-white/60" />
        )}

        {/* No resume warning */}
        {!hasResume && !jobLoading && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Upload and parse a resume first - the generator uses your actual experience to write a personalised letter.{" "}
            <Link href="/dashboard/resume" className="font-semibold underline">
              Go to resume page
            </Link>
          </div>
        )}

        {/* Options panel */}
        <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)] space-y-6">
          <h2 className="text-base font-semibold text-gray-900">Customize your letter</h2>

          {/* Tone */}
          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Tone</p>
            <ToneSelector
              value={options.tone}
              onChange={(tone) => updateOptions({ tone })}
              companyName={job?.company.name}
              jobTitle={job?.title}
            />
          </div>

          {/* Length + Style */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Length</p>
              <div className="flex gap-2">
                {LENGTHS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => updateOptions({ length: l.value })}
                    className={cn(
                      "flex-1 rounded-xl border py-2.5 text-center text-sm font-medium transition",
                      options.length === l.value
                        ? "border-[#0369A1] bg-[#F0F9FF] text-[#0369A1]"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    )}
                  >
                    <span className="block">{l.label}</span>
                    <span className="block text-[10px] text-current opacity-60">{l.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Opening style</p>
              <div className="flex gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => updateOptions({ style: s.value })}
                    className={cn(
                      "flex-1 rounded-xl border py-2.5 px-1 text-center text-sm font-medium transition",
                      options.style === s.value
                        ? "border-[#0369A1] bg-[#F0F9FF] text-[#0369A1]"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    )}
                  >
                    <span className="block text-xs">{s.label}</span>
                    <span className="block text-[10px] text-current opacity-60">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Hiring manager */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Hiring manager name</p>
            <input
              type="text"
              value={options.hiringManager ?? ""}
              onChange={(e) => updateOptions({ hiringManager: e.target.value || undefined })}
              placeholder="Leave blank if unknown - defaults to 'Dear Hiring Manager'"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
            />
          </div>

          {/* Sponsorship */}
          {showSponsorshipSection && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <p className="text-sm font-medium text-gray-700">Visa sponsorship mention</p>
                <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(options.mentionSponsorship)}
                    onChange={(e) => updateOptions({ mentionSponsorship: e.target.checked })}
                    className="rounded border-gray-300 text-[#0369A1] focus:ring-[#0369A1]"
                  />
                  <span className="text-xs text-gray-500">Include</span>
                </label>
              </div>
              {options.mentionSponsorship && (
                <SponsorshipHelper
                  value={options.sponsorshipApproach ?? "omit"}
                  onChange={(sponsorshipApproach) => updateOptions({ sponsorshipApproach })}
                  companyName={job?.company.name}
                  sponsorshipScore={job?.company.sponsorship_confidence ?? 0}
                  h1bCount1yr={job?.company.h1b_sponsor_count_1yr ?? 0}
                />
              )}
            </div>
          )}

          {/* Custom instructions */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Additional instructions{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </p>
            <textarea
              value={options.customInstructions ?? ""}
              onChange={(e) => updateOptions({ customInstructions: e.target.value || undefined })}
              placeholder="e.g. 'Mention my work at Stripe specifically' or 'Keep it very concise - I prefer brevity'"
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={isGenerating || !hasResume}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0369A1] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:opacity-60"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {coverLetter ? "Regenerate cover letter" : "Generate cover letter"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generating animation */}
        {isGenerating && (
          <div className="rounded-[32px] border border-white/80 bg-white/90 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
            <GeneratingAnimation message={generatingMessage} />
          </div>
        )}

        {/* Generated letter */}
        {!isGenerating && coverLetter && (
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)] space-y-5">
            {/* Letter header row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium capitalize text-gray-600">
                  {coverLetter.tone}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium capitalize text-gray-600">
                  {coverLetter.style.replace("_", " ")}
                </span>
                {coverLetter.word_count && (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">
                    {coverLetter.word_count} words
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void toggleFavorite()}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                  coverLetter.is_favorite
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                )}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={coverLetter.is_favorite ? "currentColor" : "none"}
                />
                {coverLetter.is_favorite ? "Saved" : "Save"}
              </button>
            </div>

            {/* Subject line */}
            {coverLetter.subject_line && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                  Subject line
                </span>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {coverLetter.subject_line}
                </p>
              </div>
            )}

            {/* Document */}
            <CoverLetterDocument
              body={coverLetter.body}
              editable
              isRegenerating={isRegenerating}
              onUpdate={updateBody}
              onRegenerateParagraph={regenerateParagraph}
            />

            {/* Actions */}
            <div className="flex flex-wrap gap-2.5 pt-1 border-t border-gray-100">
              <button
                type="button"
                onClick={() => void copyToClipboard()}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition",
                  isCopied
                    ? "bg-emerald-600 text-white"
                    : "bg-[#0369A1] text-white hover:bg-[#075985]"
                )}
              >
                {isCopied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Clipboard className="h-4 w-4" />
                )}
                {isCopied ? "Copied!" : "Copy to clipboard"}
              </button>

              <button
                type="button"
                onClick={downloadTxt}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <FileText className="h-4 w-4" />
                Download .txt
              </button>

              <button
                type="button"
                onClick={() => void downloadDocx()}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <FileText className="h-4 w-4" />
                Download .docx
              </button>

              <button
                type="button"
                onClick={() => void generateVariants()}
                disabled={isGeneratingVariants}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {isGeneratingVariants ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isGeneratingVariants ? "Generating…" : "Generate 3 variants"}
              </button>

              <button
                type="button"
                onClick={() => void generate()}
                disabled={isGenerating}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </button>

              {job && (
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Apply directly
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Variants view */}
        {variants.length > 0 && (
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
            <h3 className="mb-4 text-base font-semibold text-gray-900">
              3 variants - pick your favourite
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {variants.map((v) => (
                <VariantCard key={v.id} letter={v} onSelect={() => selectVariant(v)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
