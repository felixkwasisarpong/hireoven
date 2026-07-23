"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react"

const PARTNER_TYPES = [
  "University / career center",
  "Coding bootcamp",
  "Immigration attorney",
  "Creator / YouTuber",
  "LinkedIn creator",
  "Resume coach",
  "Other",
]

type State = "idle" | "loading" | "done" | "error"

export default function PartnerInquiryForm() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [organization, setOrganization] = useState("")
  const [partnerType, setPartnerType] = useState(PARTNER_TYPES[0])
  const [audience, setAudience] = useState("")
  const [message, setMessage] = useState("")
  const [state, setState] = useState<State>("idle")
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !name.trim()) return
    setState("loading")
    setError("")
    try {
      const res = await fetch("/api/marketing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          fullName: name.trim(),
          source: "partner_inquiry",
          metadata: {
            kind: "partner_inquiry",
            organization: organization.trim() || null,
            partnerType,
            audienceSize: audience.trim() || null,
            message: message.trim() || null,
          },
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      // 409 = already on the list; still a successful capture from the user's view.
      if (!res.ok && res.status !== 409) {
        setError(body.error ?? "Something went wrong. Try again.")
        setState("error")
        return
      }
      setState("done")
    } catch {
      setError("Network error. Please try again.")
      setState("error")
    }
  }

  if (state === "done") {
    return (
      <div className="term-panel flex flex-col items-center gap-3 px-6 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center border border-[#38e08a]/25 bg-[#38e08a]/12">
          <CheckCircle2 className="h-7 w-7 text-[#38e08a]" />
        </div>
        <p className="text-[17px] font-bold text-white">Thanks — we&apos;ll be in touch.</p>
        <p className="max-w-sm text-[14px] text-[#ccd6cf]/65">
          We review every partnership request and reply personally, usually within one business day.
        </p>
      </div>
    )
  }

  const inputClass =
    "w-full border border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] px-4 py-3 text-[15px] text-[#ccd6cf] outline-none transition placeholder:text-[#ccd6cf]/40 focus:border-[#38e08a]"

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          className={inputClass}
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          className={inputClass}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="Organization"
          aria-label="Organization"
          className={inputClass}
        />
        <select
          value={partnerType}
          onChange={(e) => setPartnerType(e.target.value)}
          aria-label="Partner type"
          className={`${inputClass} term-select`}
        >
          {PARTNER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={audience}
        onChange={(e) => setAudience(e.target.value)}
        placeholder="Roughly how many people do you reach? (optional)"
        aria-label="Audience size"
        className={inputClass}
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Anything you'd like us to know? (optional)"
        aria-label="Message"
        rows={3}
        className={`${inputClass} resize-y`}
      />

      {state === "error" && <p className="text-[13px] font-medium text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={state === "loading"}
        className="term-btn term-btn-amber w-full justify-center px-6 py-3 disabled:opacity-60 sm:w-auto"
      >
        {state === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          <>
            Become a partner <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      <p className="text-[12px] text-[#ccd6cf]/45">
        We&apos;ll only use this to reach out about a partnership. No spam.
      </p>
    </form>
  )
}
