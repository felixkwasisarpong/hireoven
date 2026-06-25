import { renderLayout, textFooter, ctaButton } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

export interface LotteryBriefData {
  rescueUrl: string // /h1b-sponsors/lottery-rescue (or leaderboard fallback)
  capExemptUrl: string
  everifyUrl: string
  unsubscribeUrl: string
}

// Sent once, late March / early April. Educational tone — the most-opened email of
// the year. Not selected, not lottery-fatigued: there are concrete next paths.
export function renderLotteryBrief(d: LotteryBriefData): RenderedEmail {
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">
      H-1B lottery results have landed. Whether or not your registration was selected, there are
      concrete next steps worth knowing.
    </p>
    <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#475569;">
      If you were not selected this year:
    </p>
    <ul style="margin:0 0 6px;padding-left:20px;font-size:15px;line-height:1.6;color:#475569;">
      <li style="margin:0 0 8px;"><a href="${d.capExemptUrl}" style="color:#0f766e;text-decoration:underline;">Cap-exempt employers</a> — universities, nonprofits, and research institutions can file H-1B year-round, outside the lottery.</li>
      <li style="margin:0 0 8px;"><a href="${d.everifyUrl}" style="color:#0f766e;text-decoration:underline;">E-Verify employers</a> — required if you are extending STEM OPT to buy another lottery cycle.</li>
      <li style="margin:0 0 8px;">O-1, cap-exempt-to-cap-subject transfers, and consular options are worth discussing with an attorney.</li>
    </ul>
    ${ctaButton("See your options", d.rescueUrl)}`

  const text = `H-1B lottery results have landed. Whether or not your registration was selected, here are concrete next steps.

If you were not selected this year:
- Cap-exempt employers (file year-round, outside the lottery): ${d.capExemptUrl}
- E-Verify employers (required for STEM OPT extension): ${d.everifyUrl}
- O-1 and cap-exempt-to-cap-subject paths are worth discussing with an attorney.

See your options: ${d.rescueUrl}${textFooter(d.unsubscribeUrl)}`

  return {
    subject: "H-1B lottery results landed — here's what to do next",
    html: renderLayout({
      preheader: "Cap-exempt and E-Verify options if you were not selected.",
      bodyHtml,
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from seasonal briefs",
    }),
    text,
  }
}
