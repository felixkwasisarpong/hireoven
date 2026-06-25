import { renderLayout, textFooter, esc, ctaButton, appUrl } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

export type OptStage = 90 | 30 | 7

export interface OptExpirationData {
  stage: OptStage
  isStem: boolean // STEM OPT vs standard OPT
  capExemptUrl: string
  everifyUrl: string
  scorecardUrl: string
  unsubscribeUrl: string
}

const SUBJECTS: Record<OptStage, string> = {
  90: "Your OPT expires in 90 days — here's a checklist",
  30: "30 days until your OPT expires",
  7: "Your OPT expires in 7 days",
}

// Action, not anxiety. Concrete next steps.
export function renderOptExpiration(d: OptExpirationData): RenderedEmail {
  const items: string[] = []
  if (!d.isStem) {
    items.push(`If your degree is STEM-eligible, start your 24-month STEM extension paperwork early.`)
  }
  items.push(`Browse <a href="${d.capExemptUrl}" style="color:#0f766e;text-decoration:underline;">cap-exempt employers</a> — universities and nonprofits that can sponsor H-1B outside the lottery.`)
  items.push(`Filter to <a href="${d.everifyUrl}" style="color:#0f766e;text-decoration:underline;">E-Verify employers</a>, required for the STEM OPT extension.`)
  items.push(`Keep your resume and <a href="${d.scorecardUrl}" style="color:#0f766e;text-decoration:underline;">sponsorability scorecard</a> current so you're ready to apply.`)

  const li = items.map((i) => `<li style="margin:0 0 8px;">${i}</li>`).join("")

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">
      Your ${d.isStem ? "STEM OPT" : "OPT"} work authorization ends in ${d.stage} days. A short checklist to stay ahead of it:
    </p>
    <ul style="margin:0 0 4px;padding-left:20px;font-size:15px;line-height:1.6;color:#475569;">${li}</ul>
    ${ctaButton("Update your scorecard", d.scorecardUrl)}
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
      This is informational, not legal advice. Confirm timelines with a qualified immigration attorney.
    </p>`

  const textItems = [
    d.isStem ? null : "If your degree is STEM-eligible, start your 24-month STEM extension paperwork early.",
    `Cap-exempt employers: ${d.capExemptUrl}`,
    `E-Verify employers: ${d.everifyUrl}`,
    `Keep your resume and scorecard current: ${d.scorecardUrl}`,
  ].filter(Boolean)

  const text = `Your ${d.isStem ? "STEM OPT" : "OPT"} work authorization ends in ${d.stage} days. A short checklist:

- ${textItems.join("\n- ")}

This is informational, not legal advice.${textFooter(d.unsubscribeUrl)}`

  return {
    subject: SUBJECTS[d.stage],
    html: renderLayout({
      preheader: `${d.stage} days until your work authorization ends.`,
      bodyHtml,
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from expiration reminders",
    }),
    text,
  }
}

export { appUrl }
