import { Zap, ExternalLink, Globe } from "lucide-react"
import Navbar from "@/components/layout/Navbar"

const features = [
  {
    icon: Zap,
    title: "Real-time detection",
    description:
      "Our crawler checks career pages continuously so new listings appear in your feed within minutes, not days.",
  },
  {
    icon: ExternalLink,
    title: "Direct company links",
    description:
      "No middlemen. Every job links directly to the company's own careers page so your application lands first.",
  },
  {
    icon: Globe,
    title: "Sponsorship intel for international candidates",
    description:
      "Filter by companies known to sponsor visas so you never waste time applying where you're not eligible.",
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      {/* Hero */}
      <section className="px-6 pt-24 pb-20 text-center">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-extrabold text-gray-900 leading-tight mb-6 tracking-tight">
            Jobs served fresh.{" "}
            <span className="text-[#1D9E75]">Apply before the crowd.</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 leading-relaxed max-w-2xl mx-auto">
            We monitor thousands of company career pages in real time so you see
            new roles within minutes of posting.
          </p>

          <form className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              required
              className="flex-1 px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75] focus:border-transparent text-sm"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-[#1D9E75] hover:bg-[#188560] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              Get early access
            </button>
          </form>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="bg-white rounded-xl p-8 border border-gray-100 shadow-sm"
                >
                  <div className="w-10 h-10 bg-[#E8F7F2] rounded-lg flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 text-[#1D9E75]" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-gray-100">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} Hireoven. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  )
}
