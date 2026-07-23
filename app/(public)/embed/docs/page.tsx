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
    <pre className="mt-3 max-w-full overflow-x-auto border border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] p-3 text-[12px] leading-relaxed text-[#38e08a]">
      <code className="block min-w-0 whitespace-pre-wrap break-all">{code}</code>
    </pre>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="term-label text-[0.8rem]">{title}</h2>
      <div className="mt-2 space-y-2 break-words text-[14px] leading-relaxed text-[#ccd6cf]/70">{children}</div>
    </section>
  )
}

export default function EmbedDocsPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/embed"
          className="text-[13px] text-[#ccd6cf]/55 underline decoration-[#ccd6cf]/20 underline-offset-4 hover:text-[#38e08a]"
        >
          ← Back to widgets
        </Link>
        <p className="term-label mt-6">{"// embed_widget_docs"}</p>
        <h1 className="mt-3 text-[2.1rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.7rem]">
          Embed widget <span className="text-[#f5a623]">docs</span>
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
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
              <code>attribution_key</code> — optional partner token (<code>pub_…</code>). Ties
              impressions to your account; required for the paid-tier options below.
            </li>
            <li>
              <code>attribution=false</code> — hide the &ldquo;Powered by Hireoven&rdquo; footer.
              Honored only with a paid-tier <code>attribution_key</code>; ignored otherwise (the
              footer is mandatory on the free tier).
            </li>
            <li>
              <code>accent=%23rrggbb</code> — custom accent color, paid tier only. Free tier and
              malformed values fall back to the default.
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
            <Link
              href="/signup?next=%2Fdashboard%2Fscorecard"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              dashboard
            </Link>{" "}
            to get a share token, then embed it. If you later make the card private or revoke the
            link, the widget shows an &ldquo;unavailable&rdquo; card instead of breaking.
          </p>
          <Snippet
            code={`<iframe src="${BASE}/embed/v1/personal-scorecard/SHARE_TOKEN?theme=light"\n  width="460" height="320" style="border:0;max-width:100%"\n  loading="lazy" title="My H-1B Scorecard"></iframe>`}
          />
        </Section>

        <Section id="platforms" title="Where to paste it">
          <p>The widgets are plain iframes, so they work anywhere that allows embed/HTML blocks:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>WordPress</strong> — add a <em>Custom HTML</em> block and paste the snippet.
              (The Classic editor needs the &ldquo;Text&rdquo; tab, not &ldquo;Visual&rdquo;.)
            </li>
            <li>
              <strong>Notion</strong> — paste the iframe <em>src</em> URL on its own line and choose{" "}
              <em>Create embed</em>.
            </li>
            <li>
              <strong>Webflow / Squarespace / Wix</strong> — use the built-in <em>Embed</em> /{" "}
              <em>Code</em> element and paste the snippet.
            </li>
            <li>
              <strong>Generic HTML</strong> — paste the snippet directly into your page markup.
            </li>
            <li>
              <strong>GitHub README</strong> — GitHub strips iframes, so embeds don&rsquo;t render
              there. Link your public scorecard instead:{" "}
              <code className="break-all">[My H-1B scorecard](https://hireoven.com/scorecard/SHARE_TOKEN)</code>.
            </li>
          </ul>
        </Section>

        <Section id="attribution" title="Attribution & usage">
          <p>
            The widgets are free for any non-commercial or editorial use. The free tier shows a
            small &ldquo;Powered by Hireoven&rdquo; link, which must remain visible. Removing
            attribution requires a partner plan token. Data is sourced from public DOL and USCIS
            disclosures; see the{" "}
            <Link
              href="/h1b-sponsors/leaderboard/methodology"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
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
