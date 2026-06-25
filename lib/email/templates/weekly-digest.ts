import { renderLayout, textFooter, esc, ctaButton } from "./layout"
import type { RenderedEmail } from "./layoff-alert"

export interface WeeklyDigestData {
  subject: string
  preheader: string
  scorecard?: { score: number; delta: number | null; grade: string; recomputeUrl: string; stale: boolean }
  watched?: Array<{ name: string; rankChange: number | null; layoffChange: string | null }>
  movers?: { risers: Array<{ name: string; delta: number }>; fallers: Array<{ name: string; delta: number }> }
  layoffs?: Array<{ name: string; date: string; affected: number | null }>
  editorial?: { title: string; url: string; blurb: string | null }
  unsubscribeUrl: string
}

function sectionTitle(t: string): string {
  return `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">${esc(t)}</p>`
}

function delta(n: number | null): string {
  if (n == null || n === 0) return `<span style="color:#94a3b8;">—</span>`
  return n > 0
    ? `<span style="color:#059669;">▲ ${n}</span>`
    : `<span style="color:#dc2626;">▼ ${Math.abs(n)}</span>`
}

export function renderWeeklyDigest(d: WeeklyDigestData): RenderedEmail {
  const parts: string[] = []
  const tparts: string[] = []

  if (d.scorecard) {
    const s = d.scorecard
    const dl = s.delta == null ? "" : s.delta === 0 ? " (no change)" : s.delta > 0 ? ` (up ${s.delta})` : ` (down ${Math.abs(s.delta)})`
    parts.push(sectionTitle("Your scorecard"))
    parts.push(`<p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;">Your sponsorability score is <strong>${s.score}/100</strong> (${esc(s.grade)})${esc(dl)}.${s.stale ? ` Your resume changed since this was computed — <a href="${s.recomputeUrl}" style="color:#0f766e;">recompute</a>.` : ""}</p>`)
    tparts.push(`YOUR SCORECARD\nScore: ${s.score}/100 (${s.grade})${dl}`)
  }

  if (d.watched && d.watched.length) {
    parts.push(sectionTitle("Your watched companies"))
    const rows = d.watched
      .map(
        (w) => `<tr>
          <td style="padding:6px 8px 6px 0;font-size:14px;color:#0f172a;">${esc(w.name)}</td>
          <td style="padding:6px 8px;font-size:14px;text-align:right;">${delta(w.rankChange)}</td>
          <td style="padding:6px 0 6px 8px;font-size:13px;text-align:right;color:#64748b;">${w.layoffChange ? esc(w.layoffChange) : "—"}</td>
        </tr>`
      )
      .join("")
    parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><td style="font-size:11px;color:#94a3b8;text-transform:uppercase;">Company</td><td style="font-size:11px;color:#94a3b8;text-align:right;text-transform:uppercase;">Rank</td><td style="font-size:11px;color:#94a3b8;text-align:right;text-transform:uppercase;">Layoff</td></tr>
      ${rows}</table>`)
    tparts.push(`YOUR WATCHED COMPANIES\n${d.watched.map((w) => `- ${w.name}: rank ${w.rankChange ?? "—"}${w.layoffChange ? `, ${w.layoffChange}` : ""}`).join("\n")}`)
  }

  if (d.movers && (d.movers.risers.length || d.movers.fallers.length)) {
    parts.push(sectionTitle("This week's biggest movers"))
    const risers = d.movers.risers.map((m) => `<li style="margin:0 0 4px;">${esc(m.name)} ${delta(m.delta)}</li>`).join("")
    const fallers = d.movers.fallers.map((m) => `<li style="margin:0 0 4px;">${esc(m.name)} ${delta(m.delta)}</li>`).join("")
    parts.push(`<p style="margin:0 0 4px;font-size:13px;color:#475569;font-weight:600;">Risers</p><ul style="margin:0 0 10px;padding-left:18px;font-size:14px;color:#0f172a;">${risers}</ul>`)
    parts.push(`<p style="margin:0 0 4px;font-size:13px;color:#475569;font-weight:600;">Fallers</p><ul style="margin:0;padding-left:18px;font-size:14px;color:#0f172a;">${fallers}</ul>`)
    tparts.push(`BIGGEST MOVERS\nRisers: ${d.movers.risers.map((m) => `${m.name} (+${m.delta})`).join(", ")}\nFallers: ${d.movers.fallers.map((m) => `${m.name} (${m.delta})`).join(", ")}`)
  }

  if (d.layoffs && d.layoffs.length) {
    parts.push(sectionTitle("Layoff events to know about"))
    const li = d.layoffs
      .map((l) => `<li style="margin:0 0 4px;">${esc(l.name)} — ${esc(l.date)}${l.affected ? `, ~${l.affected.toLocaleString()} workers` : ""}</li>`)
      .join("")
    parts.push(`<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#0f172a;">${li}</ul>`)
    tparts.push(`LAYOFF EVENTS\n${d.layoffs.map((l) => `- ${l.name} — ${l.date}${l.affected ? `, ~${l.affected} workers` : ""}`).join("\n")}`)
  }

  if (d.editorial) {
    parts.push(sectionTitle("One link to read"))
    parts.push(`<p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;"><a href="${d.editorial.url}" style="color:#0f766e;text-decoration:underline;font-weight:600;">${esc(d.editorial.title)}</a>${d.editorial.blurb ? ` — ${esc(d.editorial.blurb)}` : ""}</p>`)
    tparts.push(`ONE LINK TO READ\n${d.editorial.title}: ${d.editorial.url}`)
  }

  return {
    subject: d.subject,
    html: renderLayout({
      preheader: d.preheader,
      bodyHtml: parts.join("\n"),
      unsubscribeUrl: d.unsubscribeUrl,
      unsubscribeLabel: "Unsubscribe from the weekly digest",
    }),
    text: tparts.join("\n\n") + textFooter(d.unsubscribeUrl),
  }
}
