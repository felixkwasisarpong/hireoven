import Image from "next/image"
import { Puzzle, Smartphone } from "lucide-react"

/**
 * Landing-only teaser: one asset (`public/coming_soon.png`) previews both
 * the native app and the Chrome extension.
 */
export default function ComingSoonSection() {
  return (
    <section
      className="border-y border-gray-100 bg-gradient-to-b from-slate-50/90 via-white to-slate-50/50 px-6 py-20 md:py-28"
      aria-labelledby="coming-soon-heading"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0369A1]">
            Coming soon
          </p>
          <h2
            id="coming-soon-heading"
            className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl"
          >
            Take Hireoven with you, everywhere you apply
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Native app for your pocket, Chrome extension for the careers page you&apos;re already on.
          </p>
        </div>

        {/* Both products — one preview image */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <span className="inline-flex items-center gap-2 rounded-2xl border border-gray-200/90 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#E0F2FE]">
              <Smartphone className="h-4 w-4 text-[#0369A1]" strokeWidth={2.2} />
            </span>
            iOS &amp; Android app
          </span>
          <span className="hidden text-sm font-medium text-gray-300 sm:inline" aria-hidden>
            +
          </span>
          <span className="inline-flex items-center gap-2 rounded-2xl border border-gray-200/90 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
              <Puzzle className="h-4 w-4 text-slate-700" strokeWidth={2.2} />
            </span>
            Chrome extension
          </span>
        </div>

        <div className="relative mx-auto flex w-full max-w-4xl justify-center">
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-[min(100%,400px)] w-[min(100%,520px)] -translate-x-1/2 -translate-y-1/2 animate-aurora-orb rounded-full bg-gradient-to-tr from-[#0369A1]/35 via-sky-300/30 to-fuchsia-300/25 blur-3xl motion-reduce:animate-none"
          />
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200/20 blur-2xl motion-reduce:opacity-50"
          />

          <div className="relative z-10 w-full animate-float-iphone drop-shadow-2xl motion-reduce:animate-none">
            <Image
              src="/coming_soon.png"
              alt="Hireoven mobile app and Chrome extension preview — both coming soon"
              width={1774}
              height={887}
              className="h-auto w-full select-none rounded-2xl"
              sizes="(max-width: 1024px) 92vw, 896px"
              priority={false}
            />
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-gray-500">
          <span className="text-gray-700">App:</span> dashboard, push alerts, and one-tap apply.{" "}
          <span className="text-gray-400">·</span>{" "}
          <span className="text-gray-700">Extension:</span> autofill, match, and H-1B context on the company
          site.
        </p>
        <p className="mt-4 text-center">
          <span className="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 shadow-sm">
            Coming soon
          </span>
        </p>
      </div>
    </section>
  )
}
