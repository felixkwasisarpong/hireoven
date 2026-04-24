"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles, X } from "lucide-react"
import { useToast } from "@/components/ui/ToastProvider"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminSelect,
} from "@/components/admin/AdminPrimitives"
import type { AtsType, Company, CompanySize } from "@/types"

const ATS_OPTIONS: Array<{ value: AtsType; label: string }> = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "workday", label: "Workday" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "icims", label: "iCIMS" },
  { value: "custom", label: "Custom" },
]

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Healthcare",
  "Retail",
  "Artificial Intelligence",
  "Travel & Hospitality",
  "Education",
  "Other",
]

const SIZES: CompanySize[] = ["startup", "small", "medium", "large", "enterprise"]

type AddCompanyModalProps = {
  open: boolean
  onClose: () => void
  onCreated?: (company: Company) => void
}

function detectAtsFromUrl(url: string): AtsType | null {
  const value = url.toLowerCase()
  if (value.includes("greenhouse.io")) return "greenhouse"
  if (value.includes("lever.co")) return "lever"
  if (value.includes("ashbyhq.com")) return "ashby"
  if (value.includes("myworkdayjobs.com")) return "workday"
  if (value.includes("bamboohr.com")) return "bamboohr"
  if (value.includes("icims.com")) return "icims"
  return null
}

function extractIdentifier(url: string, atsType: AtsType | null) {
  if (!atsType) return ""

  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/").filter(Boolean)
    if (atsType === "greenhouse") return parts[0] ?? parsed.hostname.split(".")[0] ?? ""
    if (atsType === "lever") return parts[0] ?? ""
    if (atsType === "ashby") return parts[0] ?? ""
    if (atsType === "workday") return parts[parts.length - 1] ?? ""
    if (atsType === "bamboohr") return parsed.hostname.split(".")[0] ?? ""
    return ""
  } catch {
    return ""
  }
}

export default function AddCompanyModal({
  open,
  onClose,
  onCreated,
}: AddCompanyModalProps) {
  const { pushToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    domain: "",
    careersUrl: "",
    atsType: "" as AtsType | "",
    atsIdentifier: "",
    industry: "",
    size: "" as CompanySize | "",
    logoUrl: "",
  })

  if (!open) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!form.name || !form.domain || !form.careersUrl) {
      pushToast({
        tone: "error",
        title: "Missing required fields",
        description: "Name, domain, and careers URL are required.",
      })
      return
    }

    setLoading(true)

    try {
      let parsedDomain = form.domain.trim()
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsedDomain)) {
        parsedDomain = new URL(
          parsedDomain.startsWith("http") ? parsedDomain : `https://${parsedDomain}`
        ).hostname
      }

      const payload = {
        name: form.name.trim(),
        domain: parsedDomain,
        careers_url: form.careersUrl.trim(),
        ats_type: form.atsType || null,
        ats_identifier: form.atsIdentifier.trim() || null,
        industry: form.industry || null,
        size: form.size || null,
        logo_url: form.logoUrl.trim() || null,
        is_active: true,
      }

      const createRes = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!createRes.ok) throw new Error("Failed to create company")
      const { company: data } = (await createRes.json()) as { company: { id: string } }

      const response = await fetch("/api/admin/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "company", id: data.id }),
      })

      if (!response.ok) {
        throw new Error("Company added, but the crawl could not be started.")
      }

      pushToast({
        tone: "success",
        title: "Company added",
        description: "Company added and crawl started.",
      })

      onCreated?.(data as Company)
      onClose()
      setForm({
        name: "",
        domain: "",
        careersUrl: "",
        atsType: "",
        atsIdentifier: "",
        industry: "",
        size: "",
        logoUrl: "",
      })
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Unable to add company",
        description: (error as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  const detectedAts = detectAtsFromUrl(form.careersUrl)

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/55 p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
              Add company
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-950">
              Start tracking a new company
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Add the company record, capture its ATS config, and kick off the first crawl.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close add company modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-gray-700">
              Company name
              <AdminInput
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Example: Cloudflare"
              />
            </label>
            <label className="space-y-2 text-sm font-medium text-gray-700">
              Domain
              <AdminInput
                value={form.domain}
                onChange={(event) =>
                  setForm((current) => ({ ...current, domain: event.target.value }))
                }
                placeholder="cloudflare.com"
              />
            </label>
          </div>

          <label className="space-y-2 text-sm font-medium text-gray-700">
            Careers page URL
            <AdminInput
              value={form.careersUrl}
              onChange={(event) => {
                const careersUrl = event.target.value
                const detected = detectAtsFromUrl(careersUrl)
                setForm((current) => ({
                  ...current,
                  careersUrl,
                  atsType: detected ?? current.atsType,
                  atsIdentifier: current.atsIdentifier || extractIdentifier(careersUrl, detected),
                }))
              }}
              placeholder="https://company.greenhouse.io/jobs"
            />
            {detectedAts ? (
              <div className="flex items-center gap-2 text-sm text-sky-700">
                <Sparkles className="h-4 w-4" />
                Auto-detected {detectedAts} from careers URL.
              </div>
            ) : null}
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-gray-700">
              ATS type
              <AdminSelect
                value={form.atsType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    atsType: event.target.value as AtsType,
                  }))
                }
              >
                <option value="">Select ATS</option>
                {ATS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </AdminSelect>
            </label>
            <label className="space-y-2 text-sm font-medium text-gray-700">
              ATS identifier
              <AdminInput
                value={form.atsIdentifier}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    atsIdentifier: event.target.value,
                  }))
                }
                placeholder="company slug or Workday site id"
              />
              <p className="text-xs leading-5 text-gray-500">
                Use the Greenhouse/Lever slug, Ashby path, or Workday site id from the URL.
              </p>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm font-medium text-gray-700">
              Industry
              <AdminSelect
                value={form.industry}
                onChange={(event) =>
                  setForm((current) => ({ ...current, industry: event.target.value }))
                }
              >
                <option value="">Select industry</option>
                {INDUSTRIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </AdminSelect>
            </label>
            <label className="space-y-2 text-sm font-medium text-gray-700">
              Company size
              <AdminSelect
                value={form.size}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    size: event.target.value as CompanySize,
                  }))
                }
              >
                <option value="">Select size</option>
                {SIZES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </AdminSelect>
            </label>
            <label className="space-y-2 text-sm font-medium text-gray-700">
              Logo URL
              <AdminInput
                value={form.logoUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, logoUrl: event.target.value }))
                }
                placeholder="https://..."
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {form.atsType ? <AdminBadge tone="info">{form.atsType}</AdminBadge> : null}
            {form.atsIdentifier ? <AdminBadge>{form.atsIdentifier}</AdminBadge> : null}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <AdminButton type="button" tone="secondary" onClick={onClose}>
              Cancel
            </AdminButton>
            <AdminButton type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding company
                </>
              ) : (
                "Add company"
              )}
            </AdminButton>
          </div>
        </form>
      </div>
    </div>
  )
}
