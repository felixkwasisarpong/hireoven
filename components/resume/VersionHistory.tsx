"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, RotateCcw, Save, SplitSquareVertical } from "lucide-react"
import { buildResumeSnapshot } from "@/lib/resume/scoring"
import { createClient } from "@/lib/supabase/client"
import type { Resume, ResumeSnapshot, ResumeVersion } from "@/types"

type VersionHistoryProps = {
  resume: Resume
  jobLabel?: string | null
  onRestore: (snapshot: ResumeSnapshot) => Promise<void> | void
}

export default function VersionHistory({
  resume,
  jobLabel,
  onRestore,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [name, setName] = useState(jobLabel ? `Tailored for ${jobLabel}` : "New saved version")
  const [showComposer, setShowComposer] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadVersions() {
    const supabase = createClient()
    const { data } = await supabase
      .from("resume_versions")
      .select("*")
      .eq("resume_id", resume.id)
      .order("created_at", { ascending: false })

    setVersions((data ?? []) as ResumeVersion[])
  }

  useEffect(() => {
    void loadVersions()
  }, [resume.id])

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions]
  )

  async function saveCurrentVersion() {
    setSaving(true)
    const supabase = createClient()
    const nextVersionNumber =
      versions.reduce((max, version) => Math.max(max, version.version_number), 0) + 1

    const { error } = await (supabase
      .from("resume_versions")
      .insert({
        resume_id: resume.id,
        user_id: resume.user_id,
        version_number: nextVersionNumber,
        name: name.trim() || `Version ${nextVersionNumber}`,
        file_url: null,
        snapshot: buildResumeSnapshot(resume),
        changes_summary: jobLabel
          ? `Saved while optimizing for ${jobLabel}.`
          : "Saved from the AI resume editor.",
      } as any))

    setSaving(false)
    if (!error) {
      setShowComposer(false)
      await loadVersions()
    }
  }

  return (
    <section className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0369A1]">
            Version history
          </p>
          <h3 className="mt-2 text-xl font-semibold text-gray-900">
            Save targeted versions
          </h3>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Keep role-specific variants without losing your base resume.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowComposer((current) => !current)}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
        >
          <Save className="h-4 w-4" />
          Save current version
        </button>
      </div>

      {showComposer && (
        <div className="mt-4 rounded-2xl border border-[#D6EEFF] bg-[#F5FBFF] p-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
              Version name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none"
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveCurrentVersion()}
              className="rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save version"}
            </button>
            <button
              type="button"
              onClick={() => setShowComposer(false)}
              className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-3">
          {versions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-[#FAFCFF] px-4 py-5 text-sm text-gray-500">
              No saved versions yet.
            </div>
          ) : (
            versions.map((version) => (
              <article
                key={version.id}
                className={`rounded-2xl border px-4 py-4 transition ${
                  selectedVersionId === version.id
                    ? "border-[#7DD3FC] bg-[#F5FBFF]"
                    : "border-gray-200 bg-[#FAFCFF]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      Version {version.version_number}
                      {version.name ? ` · ${version.name}` : ""}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-400">
                      {new Date(version.created_at).toLocaleString()}
                    </p>
                    {version.changes_summary && (
                      <p className="mt-2 text-sm leading-6 text-gray-500">
                        {version.changes_summary}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedVersionId(version.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                    >
                      <SplitSquareVertical className="h-4 w-4" />
                      Compare
                    </button>
                    <button
                      type="button"
                      disabled={!version.snapshot}
                      onClick={() => version.snapshot && void onRestore(version.snapshot)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore
                    </button>
                    <button
                      type="button"
                      disabled={!version.file_url}
                      onClick={() => version.file_url && window.open(version.file_url, "_blank")}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
            Compare with current
          </p>
          {selectedVersion?.snapshot ? (
            <div className="mt-4 grid gap-4">
              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <p className="text-sm font-semibold text-gray-900">Current summary</p>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {resume.summary ?? "No summary yet."}
                </p>
                <p className="mt-3 text-xs text-gray-400">
                  Top skills: {(resume.top_skills ?? []).slice(0, 5).join(", ") || "Not set"}
                </p>
              </div>
              <div className="rounded-2xl border border-[#BAE6FD] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-gray-900">
                  {selectedVersion.name ?? `Version ${selectedVersion.version_number}`}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {selectedVersion.snapshot.summary ?? "No summary saved."}
                </p>
                <p className="mt-3 text-xs text-gray-400">
                  Top skills: {(selectedVersion.snapshot.top_skills ?? []).slice(0, 5).join(", ") || "Not set"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              Select a version to compare it against your current resume.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
