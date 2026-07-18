import { renderLayout, textFooter, esc, ctaButton, appUrl } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

export interface DailyJobsEmailJob {
  id: string
  title: string
  company: string | null
  location: string | null
  isRemote: boolean
  fresh: string
}

export interface DailyJobsEmailData {
  /** e.g. "Friday, July 18" */
  dateLabel: string
  totals: {
    newJobs: number
    aiJobs: number
    remoteJobs: number
    sponsorCompanies: number
  }
  jobs: DailyJobsEmailJob[]
  reportUrl: string
  browseUrl: string
  unsubscribeUrl: string
}

function n(v: number): string {
  return v.toLocaleString("en-US")
}

function statCell(value: number, label: string): string {
  return `<td align="center" style="padding:10px 6px;">
    <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1;">${n(value)}</div>
    <div style="margin-top:4px;font-size:11px;line-height:1.3;color:#64748b;">${esc(label)}</div>
  </td>`
}

export function renderDailyJobsEmail(d: DailyJobsEmailData): RenderedEmail {
  const parts: string[] = []

  parts.push(
    `<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#FF5C18;">Fresh jobs · ${esc(d.dateLabel)}</p>`,
  )
  parts.push(
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">Here's what landed on company career pages overnight — before the boards caught up.</p>`,
  )

  // Stat strip
  parts.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f8fafc;border:1px solid #eef1f5;border-radius:12px;margin:0 0 8px;">
      <tr>
        ${statCell(d.totals.newJobs, "fresh jobs")}
        ${statCell(d.totals.aiJobs, "AI / ML")}
        ${statCell(d.totals.remoteJobs, "remote")}
        ${statCell(d.totals.sponsorCompanies, "sponsors")}
      </tr>
    </table>`,
  )

  // Job list
  if (d.jobs.length) {
    parts.push(
      `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">Freshest overnight</p>`,
    )
    const rows = d.jobs
      .map((j) => {
        const where = j.isRemote ? "Remote" : j.location ? esc(j.location) : ""
        const meta = [j.company ? esc(j.company) : "", where].filter(Boolean).join(" · ")
        return `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${esc(appUrl(`/jobs/${j.id}`))}" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;">${esc(j.title)}</a>
          <div style="margin-top:2px;font-size:12.5px;color:#64748b;">${meta}${meta ? " · " : ""}<span style="color:#94a3b8;">${esc(j.fresh)}</span></div>
        </td></tr>`
      })
      .join("")
    parts.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`,
    )
  }

  parts.push(ctaButton("See today's full report", d.reportUrl))
  parts.push(
    `<p style="margin:8px 0 0;font-size:13px;color:#64748b;">or <a href="${esc(d.browseUrl)}" style="color:#0f766e;text-decoration:underline;">browse jobs by role, location &amp; visa</a></p>`,
  )

  // Plain-text
  const tparts: string[] = []
  tparts.push(`FRESH JOBS — ${d.dateLabel}`)
  tparts.push(
    `${n(d.totals.newJobs)} fresh jobs · ${n(d.totals.aiJobs)} AI/ML · ${n(d.totals.remoteJobs)} remote · ${n(d.totals.sponsorCompanies)} sponsor companies`,
  )
  if (d.jobs.length) {
    tparts.push(
      "FRESHEST OVERNIGHT\n" +
        d.jobs
          .map((j) => {
            const where = j.isRemote ? "Remote" : j.location ?? ""
            const meta = [j.company ?? "", where].filter(Boolean).join(" · ")
            return `- ${j.title}${meta ? ` (${meta})` : ""} — ${appUrl(`/jobs/${j.id}`)}`
          })
          .join("\n"),
    )
  }
  tparts.push(`Full report: ${d.reportUrl}\nBrowse jobs: ${d.browseUrl}`)

  return {
    subject: `${n(d.totals.newJobs)} fresh jobs posted overnight`,
    html: renderLayout({
      preheader: "New listings straight from company career pages — before they hit the boards.",
      bodyHtml: parts.join("\n"),
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from daily jobs",
    }),
    text: tparts.join("\n\n") + textFooter(d.unsubscribeUrl),
  }
}
