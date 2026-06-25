import { renderLayout, textFooter, esc, ctaButton } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

export interface MilestoneData {
  views: number
  topDomains: string[] // up to 3 referer domains
  cardUrl: string
  embedUrl: string // dashboard scorecard (embed tab)
  revokeUrl: string
  unsubscribeUrl: string
}

export function renderScorecardMilestone(d: MilestoneData): RenderedEmail {
  const from =
    d.topDomains.length > 0 ? `Most viewers came from: ${d.topDomains.join(", ")}.` : "Viewers came from across the web."

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">
      Nice — your public scorecard has been viewed ${d.views.toLocaleString()} times since you shared it.
    </p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#475569;">${esc(from)}</p>
    ${ctaButton("See your card", d.cardUrl)}
    <p style="margin:10px 0 0;font-size:14px;line-height:1.6;">
      <a href="${d.embedUrl}" style="color:#0f766e;text-decoration:underline;">Embed it on your portfolio</a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">
      Want to remove it from public view? <a href="${d.revokeUrl}" style="color:#64748b;text-decoration:underline;">Make it private</a>.
    </p>`

  const text = `Nice — your public scorecard has been viewed ${d.views.toLocaleString()} times since you shared it.

${from}

See your card: ${d.cardUrl}
Embed it on your portfolio: ${d.embedUrl}

Want to remove it from public view? ${d.revokeUrl}${textFooter(d.unsubscribeUrl)}`

  return {
    subject: `Your scorecard hit ${d.views.toLocaleString()} views`,
    html: renderLayout({
      preheader: `${d.views.toLocaleString()} people have viewed your scorecard.`,
      bodyHtml,
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from milestone emails",
    }),
    text,
  }
}
