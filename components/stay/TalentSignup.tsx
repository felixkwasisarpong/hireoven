"use client"

import { useEffect, useState, useTransition } from "react"
import { submitTalentProfile } from "@/app/(public)/stay/actions"
import { TALENT_VISA_STATUS, VISA_STATUS_LABEL, type TalentVisaStatus } from "@/lib/stay/talent-types"

const TERM_SELECT_STYLE: React.CSSProperties = {
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundColor: "#0a0e0c",
  color: "#ccd6cf",
  border: "1px solid rgba(120,200,160,0.2)",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ccd6cf' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.65rem center",
  paddingRight: "1.9rem",
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]

const inputCls =
  "w-full border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-3 py-2.5 text-[14px] text-[#ccd6cf] outline-none placeholder:text-[#ccd6cf]/35 focus:border-[#38e08a]"
const selectCls = "w-full px-3 py-2.5 text-[14px] outline-none"

function getVisitorId(): string | undefined {
  try {
    const KEY = "ho_visitor_id"
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() ?? String(Math.random()).slice(2)) + ""
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

export default function TalentSignup({
  roleOptions = [],
}: {
  roleOptions?: { socGroup: string; label: string }[]
}) {
  const [email, setEmail] = useState("")
  const [headline, setHeadline] = useState("")
  const [socGroup, setSocGroup] = useState("")
  const [stateAbbr, setStateAbbr] = useState("")
  const [visaStatus, setVisaStatus] = useState<TalentVisaStatus>("opt")
  const [salary, setSalary] = useState("")
  const [skills, setSkills] = useState("")
  const [status, setStatus] = useState<"idle" | "done" | "error" | "invalid">("idle")
  const [pending, start] = useTransition()
  const [visitorId, setVisitorId] = useState<string | undefined>(undefined)

  useEffect(() => setVisitorId(getVisitorId()), [])

  const submit = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus("invalid")
      return
    }
    start(async () => {
      const res = await submitTalentProfile({
        email,
        headline: headline || null,
        socGroup: socGroup || null,
        targetSalary: salary ? Number(salary.replace(/[^0-9]/g, "")) : null,
        visaStatus,
        isStem: visaStatus === "stem_opt",
        stateAbbr: stateAbbr || null,
        topSkills: skills ? skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
        visitorId,
      })
      setStatus(res.ok ? "done" : "error")
    })
  }

  if (status === "done") {
    return (
      <div className="term-panel p-6 text-center">
        <p className="text-[17px] font-semibold text-[#38e08a]">You&apos;re in the pool.</p>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[#ccd6cf]/70">
          Only employers with verified DOL sponsorship history can reach you. Update or withdraw any time by
          re-submitting with the same email.
        </p>
      </div>
    )
  }

  return (
    <div className="term-panel p-5 sm:p-6">
      <p className="term-label">Get discovered</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Email *</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" className={inputCls} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">One-line headline</span>
          <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="MS CS new-grad · ML · open to relocate" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Target role</span>
          <select value={socGroup} onChange={(e) => setSocGroup(e.target.value)} style={TERM_SELECT_STYLE} className={selectCls}>
            <option value="">Select a role</option>
            {roleOptions.map((r) => (
              <option key={r.socGroup} value={r.socGroup}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Visa status</span>
          <select value={visaStatus} onChange={(e) => setVisaStatus(e.target.value as TalentVisaStatus)} style={TERM_SELECT_STYLE} className={selectCls}>
            {TALENT_VISA_STATUS.map((v) => (
              <option key={v} value={v}>{VISA_STATUS_LABEL[v]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Target salary (USD)</span>
          <input type="text" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="e.g. 95000" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Location (state)</span>
          <select value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} style={TERM_SELECT_STYLE} className={selectCls}>
            <option value="">Any / remote</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-medium text-[#ccd6cf]/70">Top skills (comma-separated)</span>
          <input type="text" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Python, PyTorch, AWS, SQL" className={inputCls} />
        </label>
      </div>

      <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-[11px] leading-relaxed text-[#6c7a72]">
          Only employers with verified DOL sponsorship history can see this. We never sell your data; re-submit to
          update or withdraw.
        </p>
        <button type="button" onClick={submit} disabled={pending} className="term-btn term-btn-amber shrink-0 disabled:opacity-60">
          {pending ? "adding…" : "Add me to the pool"}
        </button>
      </div>
      {status === "invalid" && <p className="mt-2 text-[12px] text-[#f5a623]">Enter a valid email to continue.</p>}
      {status === "error" && <p className="mt-2 text-[12px] text-[#f5a623]">Couldn&apos;t save that right now — try again shortly.</p>}
    </div>
  )
}
