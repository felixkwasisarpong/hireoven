import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"

export const metadata: Metadata = {
  title: "Embed Widget Docs — Hireoven",
  description:
    "How to embed Hireoven H-1B widgets: URL formats, theme and size options, attribution policy, and privacy.",
  alternates: { canonical: "/embed/docs" },
}

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

function Snippet({ code }: { code: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100">
      <code>{code}</code>
    </pre>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-slate-600">{children}</div>
    </section>
  )
}

export default function EmbedDocsPage() {
  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/embed" className="text-sm text-slate-500 underline hover:text-slate-700">
          ← Back to widgets
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Embed widget docs</h1>
        <p className="mt-2 text-slate-600">
          Every widget is a plain <code>&lt;iframe&gt;</code>. Paste the snippet anywhere HTML is
          allowed. No script tag, no API key for the public widgets.
        </p>

        <Section id="options" title="Common options">
          <p>All widgets accept these query parameters:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code>theme</code> — <code>light</code> (default), <code>dark</code>, or{" "}
              <code>auto</code> (follows the visitor&rsquo;s system setting).
            </li>
            <li>
              <code>token</code> — optional partner token. Without one, widgets show a small
              &ldquo;Powered by Hireoven&rdquo; link (always present on the free tier).
            </li>
            <li>
              Set the iframe <code>width</code>/<code>height</code> to fit your layout. Widgets are
              responsive up to ~460px wide.
            </li>
          </ul>
        </Section>

        <Section id="leaderboard" title="Sponsor leaderboard">
          <p>
            Top employers by certified LCA filings. Optional <code>state</code> (2-letter),{" "}
            <code>sort</code> (<code>volume</code> or <code>cert_rate</code>),{" "}
            <code>exclude_staffing=true</code>, and <code>limit</code> (3–15).
          </p>
          <Snippet
            code={`<iframe src="${BASE}/embed/v1/leaderboard?theme=light&limit=10"\n  width="460" height="520" style="border:0;max-width:100%"\n  loading="lazy" title="Top H-1B Sponsors"></iframe>`}
          />
        </Section>

        <Section id="company" title="Company scorecard">
          <p>
            One company&rsquo;s H-1B sponsorability grade. Use the company&rsquo;s Hireoven id (the
            UUID in its profile URL).
          </p>
          <Snippet
            code={`<iframe src="${BASE}/embed/v1/company-scorecard/COMPANY_ID?theme=light"\n  width="460" height="250" style="border:0;max-width:100%"\n  loading="lazy" title="H-1B Scorecard"></iframe>`}
          />
        </Section>

        <Section id="personal" title="Personal scorecard">
          <p>
            Your own sponsorability scorecard. Publish it from your{" "}
            <Link href="/dashboard/scorecard" className="underline hover:text-slate-800">
              dashboard
            </Link>{" "}
            to get a share token, then embed it. If you later make the card private or revoke the
            link, the widget shows an &ldquo;unavailable&rdquo; card instead of breaking.
          </p>
          <Snippet
            code={`<iframe src="${BASE}/embed/v1/personal-scorecard/SHARE_TOKEN?theme=light"\n  width="460" height="320" style="border:0;max-width:100%"\n  loading="lazy" title="My H-1B Scorecard"></iframe>`}
          />
        </Section>

        <Section id="attribution" title="Attribution & usage">
          <p>
            The widgets are free for any non-commercial or editorial use. The free tier shows a
            small &ldquo;Powered by Hireoven&rdquo; link, which must remain visible. Removing
            attribution requires a partner plan token. Data is sourced from public DOL and USCIS
            disclosures; see the{" "}
            <Link href="/h1b-sponsors/leaderboard/methodology" className="underline hover:text-slate-800">
              methodology
            </Link>
            .
          </p>
        </Section>

        <Section id="privacy" title="Privacy">
          <p>
            Widgets set no cookies and run no tracking script on your page. For aggregate analytics
            we record only the embedding site&rsquo;s domain and a hashed, truncated user-agent —
            never IP addresses, full URLs, or any visitor identity.
          </p>
        </Section>
      </main>
    </div>
  )
}
