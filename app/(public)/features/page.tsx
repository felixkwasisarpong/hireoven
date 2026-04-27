import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import {
  CoreFeaturesTable,
  InternationalFeaturesTable,
} from "@/components/marketing/MarketingFeatureBlocks"
import { CORE_FEATURES, FEATURES_HERO, INTERNATIONAL_HIGHLIGHTS } from "@/lib/marketing/product-features"

export const metadata: Metadata = {
  title: "Features — Hireoven",
  description:
    "Fresh job feed, AI match scores, one-click apply, and international job-search signals—visa context, company history, OPT tools, and offer checklists. Decision support, not legal advice.",
}

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <section className="border-b border-gray-100 px-6 py-14 md:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0369A1]">{FEATURES_HERO.kicker}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl md:text-[2.75rem]">
            {FEATURES_HERO.title}
          </h1>
          <p className="mt-4 text-lg text-gray-600">{FEATURES_HERO.subtitle}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#0369A1]/20 transition hover:bg-[#075985]"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-7 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Pricing
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Move fast on every application</h2>
            <p className="mt-2 text-gray-600">
              Everything that keeps you out of spreadsheets and copy-paste loops—one surface, row by row.
            </p>
          </div>
          <CoreFeaturesTable features={CORE_FEATURES} />
        </div>
      </section>

      <section className="border-y border-[#E0F2FE] bg-[#F0F9FF] px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              International &amp; offer intelligence
            </h2>
            <p className="mt-2 text-gray-600">
              Layered on the same job feed and job pages when you need it. These are search and organization tools—verify
              anything that matters with the employer, your DSO, or counsel.
            </p>
          </div>
          <InternationalFeaturesTable items={INTERNATIONAL_HIGHLIGHTS} />
        </div>
      </section>

      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#0369A1] hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-gray-100 bg-white px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-gray-500 sm:flex-row">
          <Link href="/" className="font-semibold text-gray-800 hover:text-[#0369A1]">
            ← Back to home
          </Link>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/companies" className="hover:text-gray-800">
              Companies
            </Link>
            <Link href="/pricing" className="hover:text-gray-800">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-gray-800">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
