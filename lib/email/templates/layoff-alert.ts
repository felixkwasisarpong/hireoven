import { renderLayout, textFooter, esc, ctaButton } from "./layout"

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface LayoffAlertData {
  companyName: string
  source: string // "WARN" | "layoffs.fyi" | "news"
  eventDate: string // human, e.g. "Mar 3"
  employeesAffected: number | null
  location: string | null
  nthEvent: number // count in last 12 months (this event inclusive)
  signalUrl: string // company layoff-signal page
  rolesUrl: string // other employers hiring
  unsubscribeUrl: string
}

// Tone is deliberately factual and low-drama — visa holders read these on bad days.
// No emoji, no "BREAKING", no exclamation marks.
export function renderLayoffAlert(d: LayoffAlertData): RenderedEmail {
  const count = d.employeesAffected ? `an estimated ${d.employeesAffected.toLocaleString()} workers` : "an undisclosed number of workers"
  const where = d.location ? ` in ${d.location}` : ""
  const nth = d.nthEvent === 1 ? "the first reported event" : `the ${ordinal(d.nthEvent)} reported event`
  const sourceLabel = d.source === "WARN" ? "a WARN notice" : `a layoff event (${d.source})`

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">
      ${esc(d.companyName)} filed ${esc(sourceLabel)} on ${esc(d.eventDate)} affecting ${esc(count)}${esc(where)}.
    </p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#475569;">
      This is ${esc(nth)} in the last 12 months. You are watching ${esc(d.companyName)}.
    </p>
    ${ctaButton("See the full layoff signal", d.signalUrl)}
    <p style="margin:10px 0 0;font-size:14px;line-height:1.6;">
      <a href="${d.rolesUrl}" style="color:#0f766e;text-decoration:underline;">See other employers hiring in your area</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
      Source: ${esc(d.source)} filings. Verify with the employer.
    </p>`

  const text = `${d.companyName} filed ${sourceLabel} on ${d.eventDate} affecting ${count}${where}.

This is ${nth} in the last 12 months. You are watching ${d.companyName}.

See the full layoff signal: ${d.signalUrl}
See other employers hiring in your area: ${d.rolesUrl}

Source: ${d.source} filings. Verify with the employer.${textFooter(d.unsubscribeUrl)}`

  return {
    subject: `${d.companyName} reported a layoff event`,
    html: renderLayout({
      preheader: `${d.companyName} filed ${d.source} on ${d.eventDate}.`,
      bodyHtml,
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from layoff alerts",
    }),
    text,
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
