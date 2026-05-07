"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type Snapshot = { ts: number; code: string }

type Props = {
  sessionId: string
  language: string
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

// Simple line diff: returns line indices (1-based) in `curr` that differ from `prev`
function diffLines(prev: string, curr: string): { added: number[] } {
  const prevSet = new Set(prev.split("\n"))
  const currLines = curr.split("\n")
  const added: number[] = []
  currLines.forEach((line, i) => {
    if (!prevSet.has(line)) added.push(i + 1)
  })
  return { added }
}

export default function CodeReplayScrubber({ sessionId, language }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const editorRef = useRef<unknown>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const decorationsRef = useRef<string[]>([])

  useEffect(() => {
    fetch(`/api/interview/sessions/${sessionId}/coding/snapshots`)
      .then((r) => r.json())
      .then((d) => setSnapshots(d.snapshots ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId])

  // Apply diff decorations when index changes
  useEffect(() => {
    const editor = editorRef.current as { deltaDecorations: (old: string[], next: unknown[]) => string[] } | null
    if (!editor || currentIdx === 0 || snapshots.length < 2) return

    const prev = snapshots[currentIdx - 1]?.code ?? ""
    const curr = snapshots[currentIdx]?.code ?? ""
    const { added } = diffLines(prev, curr)

    const decorations = added.map((lineNum) => ({
      range: { startLineNumber: lineNum, startColumn: 1, endLineNumber: lineNum, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: "bg-emerald-900/20",
        glyphMarginClassName: "bg-emerald-500",
      },
    }))

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)
  }, [currentIdx, snapshots])

  // Playback
  const stopPlay = useCallback(() => {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    setIsPlaying(false)
  }, [])

  const startPlay = useCallback(() => {
    if (snapshots.length < 2) return
    setIsPlaying(true)

    let idx = currentIdx
    playIntervalRef.current = setInterval(() => {
      idx++
      if (idx >= snapshots.length) {
        stopPlay()
        return
      }
      setCurrentIdx(idx)
    }, 500 / speed) // 500ms base interval, divided by speed
  }, [snapshots, currentIdx, speed, stopPlay])

  useEffect(() => () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current) }, [])

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-48 animate-pulse rounded-lg bg-slate-100" /></div>
  }

  if (snapshots.length === 0) {
    return <p className="py-4 text-center text-[13px] text-slate-500">No code snapshots available for this session.</p>
  }

  const first = snapshots[0]
  const current = snapshots[currentIdx]
  const relativeMs = current.ts - first.ts

  const monacoLang = language === "python" ? "python" : "javascript"

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[12px] text-slate-500">
        <span>{snapshots.length} snapshots over {fmt(snapshots[snapshots.length - 1].ts - first.ts)}</span>
        <span className="font-mono">t+{fmt(relativeMs)}</span>
      </div>

      {/* Editor */}
      <div className="h-64 overflow-hidden rounded-xl border border-slate-200">
        <MonacoEditor
          height="100%"
          language={monacoLang}
          value={current.code}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            glyphMargin: true,
          }}
          onMount={(editor) => { editorRef.current = editor }}
          onChange={() => {}}
        />
      </div>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={snapshots.length - 1}
        value={currentIdx}
        onChange={(e) => {
          stopPlay()
          setCurrentIdx(Number(e.target.value))
        }}
        className="w-full accent-orange-500"
      />

      {/* Tick labels */}
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>+0:00</span>
        <span>+{fmt((snapshots[Math.floor(snapshots.length / 2)]?.ts ?? first.ts) - first.ts)}</span>
        <span>+{fmt(snapshots[snapshots.length - 1].ts - first.ts)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={isPlaying ? stopPlay : startPlay}
          className="rounded-lg border border-slate-200 px-4 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span className="text-[12px] text-slate-500">Speed:</span>
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { stopPlay(); setSpeed(s) }}
            className={`rounded px-2 py-0.5 text-[12px] font-semibold transition ${speed === s ? "bg-orange-100 text-orange-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  )
}
