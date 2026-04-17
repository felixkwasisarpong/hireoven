'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { getSearchPreview } from '@/lib/search'
import type { Company, JobWithCompany } from '@/types'

const STORAGE_KEY = 'hireoven_recent_searches'
const MAX_RECENT = 5
const TRENDING = ['Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer', 'Marketing Manager']

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function pushRecent(query: string) {
  const recent = [query, ...getRecent().filter((q) => q !== query)].slice(0, MAX_RECENT)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent))
}

type PreviewItem =
  | { type: 'job'; data: JobWithCompany }
  | { type: 'company'; data: Company }
  | { type: 'recent'; label: string }
  | { type: 'trending'; label: string }

export default function GlobalSearchBar() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [previewJobs, setPreviewJobs] = useState<JobWithCompany[]>([])
  const [previewCompanies, setPreviewCompanies] = useState<Company[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [recent, setRecent] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  // Load recent searches on focus
  function handleFocus() {
    setRecent(getRecent())
    setIsFocused(true)
  }

  // Debounced preview fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setPreviewJobs([])
      setPreviewCompanies([])
      setSelectedIdx(-1)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const { jobs, companies } = await getSearchPreview(query)
      setPreviewJobs(jobs)
      setPreviewCompanies(companies)
      setSelectedIdx(-1)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const previewItems: PreviewItem[] = query.trim().length >= 2
    ? [
        ...previewJobs.map((j): PreviewItem => ({ type: 'job', data: j })),
        ...previewCompanies.map((c): PreviewItem => ({ type: 'company', data: c })),
      ]
    : isFocused
      ? [
          ...recent.map((label): PreviewItem => ({ type: 'recent', label })),
          ...TRENDING.filter((t) => !recent.includes(t)).slice(0, 5 - recent.length).map((label): PreviewItem => ({ type: 'trending', label })),
        ]
      : []

  const showDropdown = isFocused && previewItems.length > 0

  function navigate(q: string) {
    if (!q.trim()) return
    pushRecent(q.trim())
    setIsFocused(false)
    setQuery('')
    router.push(`/dashboard/search?q=${encodeURIComponent(q.trim())}`)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setIsFocused(false)
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      if (selectedIdx >= 0 && previewItems[selectedIdx]) {
        const item = previewItems[selectedIdx]
        if (item.type === 'job') {
          pushRecent(item.data.title)
          router.push(`/dashboard/search?q=${encodeURIComponent(item.data.title)}`)
        } else if (item.type === 'company') {
          router.push(`/dashboard/companies/${item.data.id}`)
        } else {
          navigate(item.label)
        }
        setIsFocused(false)
        setQuery('')
      } else {
        navigate(query)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, previewItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, -1))
    }
  }

  function timeAgo(ts: string) {
    const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
    if (min < 60) return `${min}m ago`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className={`flex items-center gap-2.5 rounded-2xl border bg-white px-4 py-2.5 transition ${
        isFocused ? 'border-[#0369A1] ring-2 ring-[#0369A1]/15' : 'border-gray-200'
      }`}>
        <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search jobs and companies…"
          className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
        />
        {query ? (
          <button
            type="button"
            onClick={() => { setQuery(''); setPreviewJobs([]); setPreviewCompanies([]) }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="hidden flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:inline">
            ⌘K
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(14,30,70,0.15)]">
          {query.trim().length >= 2 ? (
            <>
              {previewJobs.length > 0 && (
                <>
                  <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">Jobs</p>
                  {previewJobs.map((job, i) => (
                    <button
                      key={job.id}
                      type="button"
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${selectedIdx === i ? 'bg-[#F0F9FF]' : 'hover:bg-gray-50'}`}
                      onClick={() => { pushRecent(job.title); router.push(`/dashboard/search?q=${encodeURIComponent(job.title)}`); setIsFocused(false); setQuery('') }}
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#E0F2FE] text-xs font-bold text-[#0C4A6E]">
                        {job.company.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{job.title}</p>
                        <p className="truncate text-xs text-gray-400">{job.company.name}</p>
                      </div>
                      <span className="flex-shrink-0 text-xs text-gray-400">{timeAgo(job.first_detected_at)}</span>
                    </button>
                  ))}
                </>
              )}
              {previewCompanies.length > 0 && (
                <>
                  <p className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">Companies</p>
                  {previewCompanies.map((company, i) => {
                    const idx = previewJobs.length + i
                    return (
                      <button
                        key={company.id}
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${selectedIdx === idx ? 'bg-[#F0F9FF]' : 'hover:bg-gray-50'}`}
                        onClick={() => { router.push(`/dashboard/companies/${company.id}`); setIsFocused(false); setQuery('') }}
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-600">
                          {company.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{company.name}</p>
                          <p className="truncate text-xs text-gray-400">{company.industry ?? 'Company'} · {company.job_count} open roles</p>
                        </div>
                      </button>
                    )
                  })}
                </>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t border-gray-100 px-4 py-3 text-sm font-medium text-[#0369A1] transition hover:bg-[#F0F9FF]"
                onClick={() => navigate(query)}
              >
                <Search className="h-4 w-4" />
                Search all results for &ldquo;{query}&rdquo;
              </button>
            </>
          ) : (
            <>
              {recent.length > 0 && (
                <>
                  <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">Recent</p>
                  {recent.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${selectedIdx === i ? 'bg-[#F0F9FF]' : 'hover:bg-gray-50'}`}
                      onClick={() => navigate(label)}
                    >
                      <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </button>
                  ))}
                </>
              )}
              <p className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">Trending</p>
              {TRENDING.filter((t) => !recent.includes(t)).slice(0, 5 - recent.length).map((label, i) => {
                const idx = recent.length + i
                return (
                  <button
                    key={label}
                    type="button"
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${selectedIdx === idx ? 'bg-[#F0F9FF]' : 'hover:bg-gray-50'}`}
                    onClick={() => navigate(label)}
                  >
                    <span className="text-sm text-gray-500">{label}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
