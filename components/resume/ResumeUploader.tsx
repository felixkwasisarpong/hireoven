"use client"

import { useMemo, useRef, useState } from "react"
import { FileUp, Loader2, Sparkles, UploadCloud, X } from "lucide-react"
import { useToast } from "@/components/ui/ToastProvider"
import {
  MAX_RESUME_SIZE_BYTES,
  isResumeFilename,
  isResumeMimeType,
} from "@/lib/resume/constants"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"

type UploadPhase = "idle" | "uploading" | "processing" | "done"

type ResumeUploaderProps = {
  onUploadComplete: (resume: Resume) => void
  compact?: boolean
  showPrompt?: boolean
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validateFile(file: File) {
  if ((!isResumeMimeType(file.type) && !isResumeFilename(file.name)) || file.size > MAX_RESUME_SIZE_BYTES) {
    return "Upload a PDF or DOCX resume that is 5MB or smaller."
  }

  return null
}

export default function ResumeUploader({
  onUploadComplete,
  compact = false,
  showPrompt = false,
}: ResumeUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const { pushToast } = useToast()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<UploadPhase>("idle")

  const helperCopy = useMemo(() => {
    if (phase === "uploading") return "Uploading..."
    if (phase === "processing") return "Parsing with AI..."
    if (phase === "done") return "Done!"
    return compact
      ? "Upload resume to see match scores"
      : "Upload your resume to unlock match scores, gap analysis, cover letters, and autofill."
  }, [compact, phase])

  function clearSelection() {
    setSelectedFile(null)
    setError(null)
    setProgress(0)
    setPhase("idle")
    if (inputRef.current) inputRef.current.value = ""
  }

  function handleFile(file: File) {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      setSelectedFile(null)
      return
    }

    setSelectedFile(file)
    setError(null)
    setProgress(0)
    setPhase("idle")
  }

  function openPicker() {
    inputRef.current?.click()
  }

  function cancelUpload() {
    xhrRef.current?.abort()
    xhrRef.current = null
    setPhase("idle")
    setProgress(0)
    pushToast({
      tone: "info",
      title: "Upload cancelled",
      description: "Your resume upload was stopped before parsing finished.",
    })
  }

  async function startUpload() {
    if (!selectedFile) return

    setPhase("uploading")
    setError(null)

    const formData = new FormData()
    formData.append("file", selectedFile)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      setProgress(Math.round((event.loaded / event.total) * 100))
    }

    xhr.onerror = () => {
      setPhase("idle")
      setError("Upload failed. Please try again.")
    }

    xhr.onabort = () => {
      setPhase("idle")
    }

    xhr.onload = async () => {
      try {
        const response = JSON.parse(xhr.responseText) as {
          resumeId?: string
          error?: string
        }

        if (xhr.status >= 400 || !response.resumeId) {
          throw new Error(response.error ?? "Upload failed")
        }

        setPhase("processing")
        setProgress(100)

        const resumeResponse = await fetch(`/api/resume/${response.resumeId}`, {
          cache: "no-store",
        })

        if (!resumeResponse.ok) {
          throw new Error("Resume uploaded, but the parsed record could not be loaded")
        }

        const resume = (await resumeResponse.json()) as Resume
        onUploadComplete(resume)
        setPhase("done")
        pushToast({
          tone: "success",
          title: "Resume uploaded",
          description: "Hireoven is reading your resume now.",
        })
      } catch (uploadError) {
        setPhase("idle")
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Upload failed. Please try again."
        )
      }
    }

    xhr.open("POST", "/api/resume/upload")
    xhr.send(formData)
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        const file = event.dataTransfer.files?.[0]
        if (file) handleFile(file)
      }}
      className={cn(
        "rounded-sm border border-dashed border-slate-300/90 bg-white transition",
        compact ? "p-4" : "p-5 sm:p-6",
        dragActive
          ? "border-[#FF5C18] bg-[#FFF7F2]"
          : "border-slate-300 hover:border-[#FFB088] hover:bg-[#FFF8F4]"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      <div className={cn("flex gap-4", compact ? "items-start" : "items-center")}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-slate-200/80 bg-slate-50/90 text-[#ea580c]">
          {phase === "uploading" || phase === "processing" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : showPrompt ? (
            <Sparkles className="h-5 w-5" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900">
            {compact ? "Resume" : "Upload your resume"}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500">{helperCopy}</p>

          {!compact && showPrompt && (
            <ul className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
              <li>AI gap analysis against any job</li>
              <li>Instant match scores on every listing</li>
              <li>One-click cover letter generation</li>
              <li>Application autofill</li>
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
        <span>Accepts .pdf and .docx</span>
        <span>Max 5MB</span>
      </div>

      {selectedFile ? (
        <div className="mt-5 rounded-sm border border-slate-200/90 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>

            {phase === "idle" && (
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Clear selected file"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {(phase === "uploading" || phase === "processing") && (
            <div className="mt-4 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-[#FF5C18] transition-all duration-300"
                  style={{ width: `${Math.max(progress, phase === "processing" ? 100 : 6)}%` }}
                />
              </div>
              <p className="text-sm text-[#ea580c]">
                {phase === "uploading" ? `Uploading... ${progress}%` : "AI is reading your resume..."}
              </p>
            </div>
          )}

          {phase === "done" && (
            <p className="mt-4 text-sm font-medium text-emerald-700">
              Resume uploaded. Parsing is underway.
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          className={cn(
            "mt-5 flex w-full items-center justify-center gap-2 rounded-sm border border-slate-200/90 bg-white text-sm font-medium text-gray-700 transition hover:border-[#FFB088] hover:bg-[#FFF8F4] hover:text-[#ea580c]",
            compact ? "px-4 py-3" : "px-5 py-4"
          )}
        >
          <FileUp className="h-4 w-4" />
          Select resume
        </button>
      )}

      {selectedFile && (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startUpload}
            disabled={phase === "uploading" || phase === "processing"}
            className="inline-flex items-center gap-2 rounded-sm bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === "uploading" || phase === "processing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {phase === "idle" ? "Upload resume" : phase === "uploading" ? "Uploading..." : "Parsing with AI..."}
          </button>

          {(phase === "uploading" || phase === "processing") ? (
            <button
              type="button"
              onClick={cancelUpload}
              className="inline-flex items-center gap-2 rounded-sm border border-slate-200/90 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Cancel upload
            </button>
          ) : (
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center gap-2 rounded-sm border border-slate-200/90 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Choose another
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
