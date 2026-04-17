import type { Job } from "@/types"

export default function DashboardPage() {
  // TODO: fetch jobs for the authenticated user from Supabase
  const jobs: Job[] = []

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Your feed</h1>
          <span className="text-sm text-gray-500">{jobs.length} new jobs</span>
        </div>

        {jobs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-16 text-center">
            <p className="text-gray-400 text-sm">
              No jobs yet — check back shortly.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="bg-white rounded-xl border border-gray-100 px-6 py-5"
              >
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-gray-900 hover:text-[#1D9E75] transition-colors"
                >
                  {job.title}
                </a>
                <p className="text-sm text-gray-500 mt-1">{job.location}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
