import { AlertTriangle, Building2, FileClock, GraduationCap, Repeat, Scale, ShieldCheck, TrendingDown } from "lucide-react"
import type { JobImmigrationIntel } from "@/lib/h1b/employer-immigration-intel"
import { PLACEMENT_SHARE_FLOOR } from "@/lib/h1b/employer-immigration-intel"
import { radarSummary } from "@/lib/h1b/green-card-radar"
import { attestationSummary } from "@/lib/h1b/cap-exempt-registry"

/**
 * Employer immigration intelligence, from DOL filings — server-renderable.
 *
 * Ordered by what changes a candidate's decision soonest: a warning that the posting may be a
 * legally-mandated PERM advert comes first, then live sponsorship intent, then the slower
 * employer-quality signals.
 *
 * Every claim here is sourced from a government filing, so the copy stays factual and attributed
 * ("this employer reported…", "in our data") rather than accusatory. The one genuinely
 * probabilistic signal — behavioural test-ad context — is labelled as context, not a finding.
 */

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`
const pctOf = (v: number) => `${Math.round(v * 100)}%`

function Row({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode
  tone: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 border-t border-[rgba(120,200,160,0.12)] pt-3.5 first:border-t-0 first:pt-0">
      <span className="mt-0.5 shrink-0" style={{ color: tone }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-white">{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-[#ccd6cf]/70">{children}</div>
      </div>
    </div>
  )
}

export default function ImmigrationIntelPanel({ intel }: { intel: JobImmigrationIntel }) {
  if (!intel.hasAnything) return null

  const { testAd, radar, followThrough, placement, transfers, capExempt, socOverride, layoffs } = intel
  const showPlacement =
    placement && placement.placementShare >= PLACEMENT_SHARE_FLOOR && placement.topEndClients.length > 0

  return (
    <div className="term-panel mt-4 p-5">
      <div className="border-b border-[rgba(120,200,160,0.12)] pb-4">
        <p className="term-label">Employer immigration record</p>
        <p className="mt-0.5 text-[13px] text-[#ccd6cf]/60">from this employer&apos;s Department of Labor filings</p>
      </div>

      <div className="mt-4 flex flex-col gap-3.5">
        {/* §3 — the strongest reason not to spend an application. */}
        {testAd?.tier === "exact" && (
          <Row icon={<AlertTriangle className="h-4 w-4" />} tone="var(--term-danger)" title="This may be a green-card test advertisement">
            {testAd.summary}
            {testAd.matches[0]?.caseStatus && (
              <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
                DOL case {testAd.matches[0].caseNumber} · {testAd.matches[0].caseStatus}
              </span>
            )}
          </Row>
        )}

        {testAd?.tier === "behavioural" && (
          <Row icon={<AlertTriangle className="h-4 w-4" />} tone="var(--term-amber-text)" title="Green-card filing pattern in this occupation">
            {testAd.summary}
          </Row>
        )}

        {/* §5 — the single biggest structural advantage a candidate can have: no lottery at all. */}
        {capExempt && (
          <Row icon={<GraduationCap className="h-4 w-4" />} tone="var(--term-green)" title="States it is exempt from the H-1B cap">
            {attestationSummary(capExempt)}
            <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
              Employer&apos;s own attestation on a Department of Labor wage determination, not a USCIS
              determination — exemption is decided per petition.
            </span>
          </Row>
        )}

        {/* §2 — live sponsorship intent. */}
        {radar.length > 0 && (
          <Row icon={<FileClock className="h-4 w-4" />} tone="var(--term-green)" title="Green-card intent detected">
            {radarSummary(radar[0])}
            {radar.length > 1 && (
              <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
                +{radar.length - 1} more active determination{radar.length - 1 === 1 ? "" : "s"} on file
              </span>
            )}
          </Row>
        )}

        {/* §6 — who you would actually work for. */}
        {showPlacement && placement && (
          <Row icon={<Building2 className="h-4 w-4" />} tone="var(--term-amber-text)" title="Third-party placement is common here">
            {pctOf(placement.placementShare)} of this employer&apos;s visa filings place the worker at a
            client company rather than at the employer itself
            {placement.distinctEndClients > 1 ? `, across ${placement.distinctEndClients} clients` : ""}. Your
            visa, salary band and layoff exposure would follow the employer of record, not the client.
            <span className="mt-1.5 block text-[12px] text-[#ccd6cf]/55">
              Most common: {placement.topEndClients.slice(0, 3).map((c) => c.endClientName).join(" · ")}
            </span>
            {placement.isDependent && (
              <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">Files as an H-1B dependent employer.</span>
            )}
          </Row>
        )}

        {/* §7 — do their certifications get used. */}
        {followThrough?.rate !== null && followThrough && (
          <Row icon={<ShieldCheck className="h-4 w-4" />} tone="var(--term-info)" title={`Green-card follow-through: ${pctOf(followThrough.rate!)}`}>
            Of {followThrough.maturedTotal} labor certifications old enough to have been used,{" "}
            {followThrough.maturedExpired} expired without the employer filing the next step.
            {followThrough.medianDecisionDays !== null && (
              <> Median time from filing to decision: {followThrough.medianDecisionDays} days.</>
            )}
            {followThrough.incumbentShare !== null && (
              <span className="mt-1 block text-[12px] text-[#ccd6cf]/55">
                {pctOf(followThrough.incumbentShare)} of their filings were for a worker who already held the job.
              </span>
            )}
            <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
              Only certifications past the 180-day window are counted — recent ones cannot have expired yet.
            </span>
          </Row>
        )}

        {/* §10 — rare, recent, and specific to the occupation. Point-in-time, never "is laying off". */}
        {layoffs.length > 0 && (
          <Row icon={<TrendingDown className="h-4 w-4" />} tone="var(--term-amber-text)" title="Reported a layoff in this occupation">
            In a green-card filing decided {layoffs[0].decisionDate ?? "recently"}, this employer stated it had
            laid off workers in {layoffs[0].socTitle ?? "this or a related occupation"}
            {layoffs[0].worksiteState ? ` (${layoffs[0].worksiteState})` : ""} during the preceding six months.
            {layoffs.length > 1 && ` ${layoffs.length} such filings on record.`}
            <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
              Describes the period before that filing, not necessarily today. Unlike WARN notices this is
              occupation-specific and federal.
            </span>
          </Row>
        )}

        {/* §9 — context, explicitly not an accusation. Only shown when well above the norm. */}
        {socOverride?.isElevated && (
          <Row icon={<Scale className="h-4 w-4" />} tone="var(--term-amber-text)" title="DOL often reclassifies their job titles">
            The Department of Labor assigned a different occupation than this employer requested on{" "}
            {pctOf(socOverride.rate)} of its {socOverride.filings} wage determinations — against a{" "}
            {pctOf(socOverride.baseline)} norm. The occupation sets the prevailing wage floor.
            <span className="mt-1 block text-[11px] text-[#ccd6cf]/45">
              Reclassification is routine and can reflect genuinely hybrid roles; it is not by itself evidence
              of underpayment.
            </span>
          </Row>
        )}

        {/* §4 — can they move you. */}
        {transfers && transfers.transferFilings > 0 && (
          <Row icon={<Repeat className="h-4 w-4" />} tone="var(--term-green)" title="Files H-1B transfers">
            {transfers.transferFilings} transfer filing{transfers.transferFilings === 1 ? "" : "s"} in the last
            year, covering {transfers.transferPositions} worker
            {transfers.transferPositions === 1 ? "" : "s"}.
            {transfers.medianDecisionDays !== null && (
              <> Median labor-condition decision: {transfers.medianDecisionDays} days.</>
            )}{" "}
            An employer that already files transfers is one that can take over an existing H-1B.
          </Row>
        )}
      </div>

      <p className="mt-4 border-t border-[rgba(120,200,160,0.12)] pt-3 text-[11px] leading-relaxed text-[#ccd6cf]/40">
        Sourced from Department of Labor LCA, PERM and prevailing-wage disclosure data. Employer matching is by
        name, so figures may be split across an employer&apos;s legal entities. Absence of a filing means none
        appears in our copy of the data, not that none exists.
      </p>
    </div>
  )
}
