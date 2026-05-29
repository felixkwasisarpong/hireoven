import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Returns the deployed commit SHA so we can verify Coolify is serving the
// latest build. Set GIT_COMMIT_SHA in the Coolify env (or it falls back to
// the commit baked at build time via NEXT_PUBLIC_GIT_COMMIT_SHA).
export async function GET() {
  return NextResponse.json({
    commit: process.env.GIT_COMMIT_SHA
      ?? process.env.NEXT_PUBLIC_GIT_COMMIT_SHA
      ?? "unknown",
    builtAt: process.env.BUILD_TIME ?? null,
    // Sentinel string that only exists in this commit so we can grep for it
    // even when GIT_COMMIT_SHA isn't set on the host.
    feature: "student_verify_top_v1",
  })
}
