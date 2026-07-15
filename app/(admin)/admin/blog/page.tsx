"use client"

import Image from "next/image"
import { useCallback, useEffect, useState } from "react"
import { BookOpen, Loader2, RefreshCw, Zap } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPrimitives"

type PostRow = {
  id: string
  slug: string
  title: string
  excerpt: string
  status: "draft" | "published"
  reading_time: number | null
  hero_image_url: string | null
  hero_image_key: string | null
  hero_image_alt: string | null
  image_prompt: string | null
  published_at: string | null
  created_at: string
  category_name: string
  category_slug: string
}

function statusTone(status: PostRow["status"]) {
  if (status === "published") return "success" as const
  return "neutral" as const
}

export default function AdminBlogPage() {
  const [rows, setRows] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/admin/blog/posts", { cache: "no-store" })
      const data = (await res.json()) as { rows?: PostRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load posts")
      setRows(data.rows ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggleStatus(post: PostRow) {
    setTogglingId(post.id)
    setActionResult(null)
    try {
      const next = post.status === "draft" ? "published" : "draft"
      const res = await fetch("/api/admin/blog/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, status: next }),
      })
      if (!res.ok) throw new Error("Update failed")
      setActionResult(
        next === "published"
          ? `"${post.title}" is now live at /blog/${post.category_slug}/${post.slug}`
          : `"${post.title}" moved back to draft`
      )
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTogglingId(null)
    }
  }

  async function runGeneration() {
    setGenerating(true)
    setActionResult(null)
    setError(null)
    try {
      const res = await fetch("/api/admin/blog/generate", { method: "POST" })
      const data = (await res.json()) as {
        ok: boolean
        message?: string
        error?: string
        skipped?: boolean
        imageGenerated?: boolean
        imageError?: string | null
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Generation failed")
      if (data.skipped) {
        setActionResult("No post scheduled today (weekend).")
      } else if (data.imageGenerated === false) {
        setError(`Draft created, but hero image generation failed${data.imageError ? `: ${data.imageError}` : "."}`)
        setActionResult(data.message ?? "Draft created.")
      } else {
        setActionResult(data.message ?? "Draft created.")
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Blog"
        title="Blog posts"
        description="Review AI-generated drafts and publish them to the public blog. One post is generated per weekday, per category."
        actions={
          <div className="flex gap-2">
            <AdminButton tone="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </AdminButton>
            <AdminButton onClick={() => void runGeneration()} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Generate today&apos;s post
            </AdminButton>
          </div>
        }
      />

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {actionResult && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{actionResult}</p>
      )}

      <AdminPanel
        title="All posts"
        description="Draft posts are not visible on the public blog. Publish to make them live."
      >
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              <tr>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Read time</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                    <BookOpen className="mx-auto mb-2 h-5 w-5 opacity-40" />
                    No posts yet. Hit &quot;Generate today&apos;s post&quot; to create the first one.
                  </td>
                </tr>
              ) : (
                rows.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="relative h-12 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                        {post.hero_image_url ? (
                          <Image
                            src={post.hero_image_url}
                            alt={post.hero_image_alt ?? post.title}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-gray-100 via-white to-orange-50" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-semibold text-gray-900 line-clamp-1">{post.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">{post.excerpt}</p>
                    </td>
                    <td className="px-4 py-3">
                      <AdminBadge tone="dark">{post.category_name}</AdminBadge>
                    </td>
                    <td className="px-4 py-3">
                      <AdminBadge tone={statusTone(post.status)}>{post.status}</AdminBadge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {post.reading_time ? `${post.reading_time} min` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(post.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {post.published_at
                        ? new Date(post.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <AdminButton
                        tone={post.status === "draft" ? "primary" : "secondary"}
                        disabled={togglingId === post.id}
                        onClick={() => void toggleStatus(post)}
                      >
                        {togglingId === post.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : post.status === "draft" ? (
                          "Publish"
                        ) : (
                          "Unpublish"
                        )}
                      </AdminButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  )
}
