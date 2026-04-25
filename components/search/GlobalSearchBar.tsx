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
    <div ref={containerRef} className="relative w-full max-w-[min(100%,520px)]">
      <div className={`flex h-7 items-center gap-1.5 rounded-lg border bg-white px-2 py-0.5 transition-colors ${
        isFocused ? 'border-[#F97316] ring-1 ring-[#FED7AA]/40' : 'border-[#D7DCEA] hover:border-[#C5CCE0]'
      }`}>
        <Search className="h-3 w-3 flex-shrink-0 text-[#9CA3AF]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search jobs, companies…"
          className="flex-1 min-h-0 min-w-0 bg-transparent text-[12px] leading-tight text-strong outline-none placeholder:text-[#9CA3AF]"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setPreviewJobs([]); setPreviewCompanies([]) }}
            className="flex-shrink-0 rounded p-0.5 text-[#9CA3AF] transition-colors hover:text-[#374151]"
            aria-label="Clear"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate(query)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#F97316] text-white transition-colors hover:bg-[#EA6C0A]"
          aria-label="Search"
        >
          <Search className="h-3 w-3" />
        </button>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[#D7DCEA] bg-white shadow-[0_26px_60px_-42px_rgba(21,35,78,0.6)]">
          {query.trim().length >= 2 ? (
            <>
              {previewJobs.length > 0 && (
                <>
                  <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Jobs</p>
                  {previewJobs.map((job, i) => (
                    <button
                      key={job.id}
                      type="button"
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selectedIdx === i ? 'bg-[#FFF7ED]' : 'hover:bg-[#F5F7FD]'}`}
                      onClick={() => { pushRecent(job.title); router.push(`/dashboard/search?q=${encodeURIComponent(job.title)}`); setIsFocused(false); setQuery('') }}
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-brand-tint text-xs font-bold text-brand-navy">
                        {job.company.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-strong">{job.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{job.company.name}</p>
                      </div>
                      <span className="flex-shrink-0 text-xs text-muted-foreground">{timeAgo(job.first_detected_at)}</span>
                    </button>
                  ))}
                </>
              )}
              {previewCompanies.length > 0 && (
                <>
                  <p className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Companies</p>
                  {previewCompanies.map((company, i) => {
                    const idx = previewJobs.length + i
                    return (
                      <button
                        key={company.id}
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selectedIdx === idx ? 'bg-[#FFF7ED]' : 'hover:bg-[#F5F7FD]'}`}
                        onClick={() => { router.push(`/dashboard/companies/${company.id}`); setIsFocused(false); setQuery('') }}
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-bold text-muted-foreground">
                          {company.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-strong">{company.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{company.industry ?? 'Company'} · {company.job_count} open roles</p>
                        </div>
                      </button>
                    )
                  })}
                </>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-brand-tint"
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
                  <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Recent</p>
                  {recent.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIdx === i ? 'bg-[#FFF7ED]' : 'hover:bg-[#F5F7FD]'}`}
                      onClick={() => navigate(label)}
                    >
                      <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </button>
                  ))}
                </>
              )}
              <p className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Trending</p>
              {TRENDING.filter((t) => !recent.includes(t)).slice(0, 5 - recent.length).map((label, i) => {
                const idx = recent.length + i
                return (
                  <button
                    key={label}
                    type="button"
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIdx === idx ? 'bg-[#FFF7ED]' : 'hover:bg-[#F5F7FD]'}`}
                    onClick={() => navigate(label)}
                  >
                    <span className="text-sm text-muted-foreground">{label}</span>
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
