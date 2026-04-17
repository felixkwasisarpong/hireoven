import Link from "next/link"

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-xl font-bold text-gray-900 block mb-8">
          Hireoven
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Create an account
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Start finding jobs before everyone else
        </p>
        {/* TODO: wire up Supabase auth */}
        <div className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75] focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75] focus:border-transparent text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-[#1D9E75] hover:bg-[#188560] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Create account
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-6 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-[#1D9E75] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
