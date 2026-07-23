import Image from "next/image"
import { Puzzle, Smartphone } from "lucide-react"

/**
 * Landing-only teaser: one asset (`public/coming_soon.png`) previews both
 * the native app and the Chrome extension.
 */
export default function ComingSoonSection() {
  return (
    <section
      className="border-y border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] px-6 py-20 font-mono md:py-28"
      aria-labelledby="coming-soon-heading"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="term-label mb-3">{"// coming soon"}</p>
          <h2
            id="coming-soon-heading"
            className="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            Take Hireoven with you, <span className="text-[#f5a623]">everywhere you apply</span>
          </h2>
          <p className="mt-4 text-lg text-[#ccd6cf]/70">
            Native app for your pocket, Chrome extension for the careers page you&apos;re already on.
          </p>
        </div>

        {/* Both products — one preview image */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <span className="inline-flex items-center gap-2 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-2 text-sm font-semibold text-[#ccd6cf]/80">
            <span className="inline-flex h-8 w-8 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
              <Smartphone className="h-4 w-4 text-[#f5a623]" strokeWidth={2.2} />
            </span>
            iOS &amp; Android app
          </span>
          <span className="hidden text-sm font-medium text-[#ccd6cf]/35 sm:inline" aria-hidden>
            +
          </span>
          <span className="inline-flex items-center gap-2 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-2 text-sm font-semibold text-[#ccd6cf]/80">
            <span className="inline-flex h-8 w-8 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
              <Puzzle className="h-4 w-4 text-[#38e08a]" strokeWidth={2.2} />
            </span>
            Chrome extension
          </span>
        </div>

        <div className="relative mx-auto flex w-full max-w-4xl justify-center">
          <div className="relative z-10 w-full border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-2">
            <Image
              src="/coming_soon.png"
              alt="Hireoven mobile app and Chrome extension preview — both coming soon"
              width={1774}
              height={887}
              className="h-auto w-full select-none"
              sizes="(max-width: 1024px) 92vw, 896px"
              priority={false}
            />
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-[#ccd6cf]/55">
          <span className="text-[#ccd6cf]/80">App:</span> dashboard, push alerts, and one-tap apply.{" "}
          <span className="text-[#ccd6cf]/35">·</span>{" "}
          <span className="text-[#ccd6cf]/80">Extension:</span> autofill, match, and H-1B context on the company
          site.
        </p>
        <p className="mt-4 text-center">
          <span className="inline-flex items-center border border-[#f5a623]/25 bg-[#f5a623]/12 px-3.5 py-1.5 text-xs font-semibold text-[#f5a623]">
            Coming soon
          </span>
        </p>
      </div>
    </section>
  )
}
