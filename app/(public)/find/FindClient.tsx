"use client"

import { useEffect, useState } from "react"
import Navbar from "@/components/layout/Navbar"
import { track } from "@/lib/analytics"

type Match = {
  id: string
  title: string
  company: string
  companyDomain: string | null
  location: string
  salary: string | null
  sponsorScore: number
  sponsorsH1b: boolean
  petitions: number | null
  freshness: string
  matchPct: number
}

const CHIPS = ["Software Engineer", "Data Analyst", "Product Manager", "Mechanical Engineer"]

// Post-signup destination reuses the EXISTING signup flow (next + role hint).
function signupHref(role: string) {
  const next = encodeURIComponent("/dashboard/onboarding")
  const r = encodeURIComponent(role || "")
  return `/signup?next=${next}&src=find&ho_role=${r}`
}

// First-party funnel beacon (persisted to our DB via /api/track/event) — runs
// alongside Vercel analytics so we own the exact landing→signup conversion math.
function beacon(name: string, role?: string) {
  try {
    let vid = localStorage.getItem("ho_vid")
    if (!vid) {
      vid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now()) + Math.round(Math.random() * 1e9)
      localStorage.setItem("ho_vid", vid)
    }
    fetch("/api/track/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, visitorId: vid, path: "/find" }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never break the page
  }
}

// Fire a Meta Pixel standard event so the ad campaign can optimize toward the
// funnel. No-ops safely if the pixel hasn't loaded (blocked, adblock, etc.).
function fbTrack(event: string, params?: Record<string, unknown>) {
  try {
    window.fbq?.("track", event, params)
  } catch {
    // pixel must never break the page
  }
}

export default function FindClient() {
  const [role, setRole] = useState("")
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [submittedRole, setSubmittedRole] = useState("")

  useEffect(() => {
    track("find_landing_view")
    beacon("find_landing_view")
  }, [])

  async function run(searchRole: string) {
    const r = searchRole.trim()
    if (!r) return
    setLoading(true)
    setSubmittedRole(r)
    track("find_role_submitted", { role: r })
    beacon("find_role_submitted", r)
    fbTrack("Search", { search_string: r })
    try {
      const res = await fetch("/api/public/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: r }),
      })
      const data = (await res.json()) as { matches?: Match[] }
      const list = data.matches ?? []
      setMatches(list)
      track("find_matches_shown", { role: r, count: list.length })
      beacon("find_matches_shown", r)
      fbTrack("ViewContent", { content_category: "sponsor_matches", search_string: r, num_items: list.length })
    } catch {
      setMatches([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="term-page min-h-dvh">
      <Navbar />
      <div className="mx-auto w-full max-w-xl px-5 py-10 sm:py-14">
        {/* HERO */}
        <p className="text-[13px] font-medium text-[#f5a623]">
          &ldquo;Do you sponsor?&rdquo; shouldn&apos;t be a final-round surprise.
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-[42px]">
          See which jobs will actually{" "}
          <span className="text-[#f5a623]">sponsor your visa</span> — before you apply.
        </h1>
        <p className="mt-4 text-[15.5px] text-[#ccd6cf]/70">
          HireOven checks every listing against real{" "}
          <span className="font-semibold text-white">DOL &amp; USCIS petition history</span>,
          so international students apply only where sponsorship is real. 1.5M jobs, minutes fresh.
        </p>

        {/* ONE-QUESTION FLOW */}
        {matches === null && (
          <div className="term-panel mt-6 p-5">
            <label className="term-label mb-2 block">What role are you targeting?</label>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                run(role)
              }}
              className="flex flex-col gap-2.5"
            >
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Software Engineer, Data Analyst…"
                className="w-full border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-3.5 font-mono text-base text-[#ccd6cf] outline-none placeholder:text-[#ccd6cf]/35 focus:border-[#38e08a]"
                autoFocus
              />
              <button type="submit" disabled={loading} className="term-btn term-btn-amber justify-center py-3.5 text-base disabled:opacity-60">
                {loading ? "Checking…" : "Show me jobs that sponsor me →"}
              </button>
            </form>
            <p className="mt-2.5 text-center text-[12.5px] text-[#ccd6cf]/55">
              <span className="font-semibold text-[#38e08a]">Free</span> · no account needed to see your matches
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setRole(c)
                    run(c)
                  }}
                  className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] text-[#ccd6cf]/70 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* RESULTS (value BEFORE signup) */}
        {matches !== null && (
          <div className="mt-6">
            {matches.length > 0 ? (
              <>
                <p className="mb-3 text-sm text-[#ccd6cf]/70">
                  <span className="font-bold text-white">{matches.length}</span>{" "}
                  sponsor-checked {submittedRole} roles, matched to you:
                </p>
                <div className="space-y-2.5">
                  {matches.map((m) => (
                    <div key={m.id} className="term-panel p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-semibold leading-tight text-white">{m.title}</div>
                          <div className="mt-0.5 text-[12.5px] text-[#ccd6cf]/55">
                            {m.company}
                            {m.location ? ` · ${m.location}` : ""}
                            {m.salary ? ` · ${m.salary}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 border border-[#38e08a]/40 bg-[#38e08a]/10 px-2.5 py-1 text-center">
                          <div className="text-base font-semibold leading-none tabular-nums text-[#38e08a]">
                            {m.sponsorScore}
                          </div>
                          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[#38e08a]">sponsor</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11.5px]">
                        {m.petitions ? (
                          <span className="border border-[#38e08a]/40 bg-[#0a0e0c] px-2 py-1 text-[#38e08a]">
                            ✓ {m.petitions.toLocaleString()} H-1B petitions
                          </span>
                        ) : m.sponsorsH1b ? (
                          <span className="border border-[#38e08a]/40 bg-[#0a0e0c] px-2 py-1 text-[#38e08a]">
                            ✓ Verified sponsor
                          </span>
                        ) : null}
                        <span className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2 py-1 text-[#ccd6cf]/55">
                          DOL+USCIS checked
                        </span>
                        {m.freshness ? (
                          <span className="border border-[#f5a623]/40 bg-[#0a0e0c] px-2 py-1 text-[#f5a623]">
                            🔥 {m.freshness}
                          </span>
                        ) : null}
                        <span className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2 py-1 text-[#ccd6cf]/55">
                          match <span className="font-semibold text-white">{m.matchPct}%</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mb-3 text-sm text-[#ccd6cf]/70">
                No sponsor-checked <span className="font-semibold text-white">{submittedRole}</span>{" "}
                roles in the freshest window right now — create a free account and we&apos;ll alert you the
                moment one posts.
              </p>
            )}

            {/* CONVERT at peak intent */}
            <div className="mt-4 border border-[#f5a623]/30 bg-[#f5a623]/[0.06] p-5 text-center">
              <h2 className="text-xl font-semibold text-white">Save these &amp; get alerts</h2>
              <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] text-[#ccd6cf]/70">
                Create a free account to save your matches and get pinged the minute a new
                sponsor-checked {submittedRole} role posts.
              </p>
              <a
                href={signupHref(submittedRole)}
                onClick={() => {
                  track("find_signup_clicked", { role: submittedRole })
                  beacon("find_signup_clicked", submittedRole)
                  fbTrack("Lead", { content_name: submittedRole || "find" })
                }}
                className="term-btn term-btn-amber mt-3.5 w-full justify-center py-3.5 text-[15px]"
              >
                Create my free account →
              </a>
              <p className="mt-3 text-[12.5px] text-[#ccd6cf]/55">
                Joining <span className="font-semibold text-white">8,200+</span> international
                students already using HireOven
              </p>
            </div>

            <button
              onClick={() => {
                setMatches(null)
                setRole("")
              }}
              className="mt-4 w-full text-center text-[13px] text-[#ccd6cf]/55 underline-offset-4 transition hover:text-[#38e08a] hover:underline"
            >
              ← Try another role
            </button>
          </div>
        )}

        {/* SOCIAL PROOF */}
        <div className="mt-8 border-t border-[rgba(120,200,160,0.2)] pt-6">
          <div className="tracking-widest text-[#f5a623]">★★★★★</div>
          <p className="mt-2 text-[17px] leading-snug text-[#ccd6cf]">
            &ldquo;Found my current role 3 days after signing up — and I knew it sponsored before I applied.&rdquo;
          </p>
          <p className="mt-1 text-[12.5px] text-[#ccd6cf]/55">— Priya M., F-1 → H-1B, Software Engineer</p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-[11.5px] text-[#ccd6cf]/55">
            <span>● DOL + USCIS verified</span>
            <span>● 1.5M+ jobs tracked</span>
            <span>● No credit card</span>
          </div>
          <p className="mt-4 text-center text-xs text-[#ccd6cf]/45">
            Trusted by international students at 200+ universities
          </p>
        </div>
      </div>
    </main>
  )
}
