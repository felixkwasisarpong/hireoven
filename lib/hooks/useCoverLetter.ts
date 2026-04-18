"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CoverLetter, CoverLetterOptions } from "@/types"

const LOADING_MESSAGES = [
  "Reading your resume…",
  "Analyzing the job requirements…",
  "Finding your strongest matches…",
  "Crafting your opening…",
  "Writing your cover letter…",
  "Polishing the final draft…",
]

const DEFAULT_OPTIONS: CoverLetterOptions = {
  tone: "professional",
  length: "medium",
  style: "story",
}

export function useCoverLetter(jobId: string) {
  const [coverLetter, setCoverLetter] = useState<CoverLetter | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false)
  const [generatingMessage, setGeneratingMessage] = useState("")
  const [options, setOptions] = useState<CoverLetterOptions>(DEFAULT_OPTIONS)
  const [isCopied, setIsCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [variants, setVariants] = useState<CoverLetter[]>([])

  const messageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const coverLetterIdRef = useRef<string | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      if (messageIntervalRef.current) clearInterval(messageIntervalRef.current)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  // Keep id ref in sync
  useEffect(() => {
    coverLetterIdRef.current = coverLetter?.id ?? null
  }, [coverLetter?.id])

  // Load existing cover letter on mount
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/cover-letter?jobId=${jobId}`)
      if (!res.ok) return
      const data = (await res.json()) as CoverLetter | null
      if (isMounted.current && data) {
        setCoverLetter(data)
        setOptions((prev) => ({
          ...prev,
          tone: data.tone,
          length: data.length,
          style: data.style,
          hiringManager: data.hiring_manager ?? undefined,
        }))
      }
    }
    void load()
  }, [jobId])

  const startMessageCycle = useCallback(() => {
    let index = 0
    setGeneratingMessage(LOADING_MESSAGES[0]!)
    messageIntervalRef.current = setInterval(() => {
      index = (index + 1) % LOADING_MESSAGES.length
      if (isMounted.current) setGeneratingMessage(LOADING_MESSAGES[index]!)
    }, 1500)
  }, [])

  const stopMessageCycle = useCallback(() => {
    if (messageIntervalRef.current) {
      clearInterval(messageIntervalRef.current)
      messageIntervalRef.current = null
    }
    setGeneratingMessage("")
  }, [])

  const updateOptions = useCallback((partial: Partial<CoverLetterOptions>) => {
    setOptions((prev) => ({ ...prev, ...partial }))
  }, [])

  const generate = useCallback(async () => {
    if (isGenerating) return
    setIsGenerating(true)
    setError(null)
    startMessageCycle()

    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, options }),
      })
      const data = (await res.json()) as CoverLetter & { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Generation failed")
      if (isMounted.current) {
        setCoverLetter(data)
        setVariants([])
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Generation failed")
      }
    } finally {
      if (isMounted.current) setIsGenerating(false)
      stopMessageCycle()
    }
  }, [isGenerating, jobId, options, startMessageCycle, stopMessageCycle])

  const regenerateParagraph = useCallback(
    async (paragraphIndex: number, instruction: string) => {
      if (!coverLetterIdRef.current || isRegenerating) return
      setIsRegenerating(true)
      setError(null)

      try {
        const res = await fetch("/api/cover-letter/regenerate-paragraph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coverLetterId: coverLetterIdRef.current,
            paragraphIndex,
            instruction,
          }),
        })
        const data = (await res.json()) as { body: string; error?: string }
        if (!res.ok) throw new Error(data.error ?? "Regeneration failed")
        if (isMounted.current) {
          setCoverLetter((prev) => (prev ? { ...prev, body: data.body } : prev))
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : "Regeneration failed")
        }
      } finally {
        if (isMounted.current) setIsRegenerating(false)
      }
    },
    [isRegenerating]
  )

  const updateBody = useCallback((newBody: string) => {
    setCoverLetter((prev) => (prev ? { ...prev, body: newBody } : prev))

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      const id = coverLetterIdRef.current
      if (!id) return
      await fetch(`/api/cover-letter/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: newBody,
          word_count: newBody.split(/\s+/).filter(Boolean).length,
        }),
      })
    }, 2000)
  }, [])

  const copyToClipboard = useCallback(async () => {
    const id = coverLetterIdRef.current
    const body = coverLetter?.body
    if (!body) return

    await navigator.clipboard.writeText(body)

    if (id) {
      void fetch(`/api/cover-letter/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ was_used: true }),
      })
    }

    if (isMounted.current) {
      setIsCopied(true)
      setTimeout(() => {
        if (isMounted.current) setIsCopied(false)
      }, 3000)
    }
  }, [coverLetter?.body])

  const downloadTxt = useCallback(() => {
    const body = coverLetter?.body
    if (!body) return
    const blob = new Blob([body], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cover-letter-${coverLetter?.company_name ?? "job"}.txt`
    a.click()
    URL.revokeObjectURL(url)
    if (coverLetterIdRef.current) {
      void fetch(`/api/cover-letter/${coverLetterIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ was_used: true }),
      })
    }
  }, [coverLetter?.body, coverLetter?.company_name])

  const downloadDocx = useCallback(async () => {
    const body = coverLetter?.body
    if (!body) return

    const { Document, Paragraph, TextRun, Packer } = await import("docx")
    const paragraphs = body.split("\n\n").map(
      (text) =>
        new Paragraph({
          children: [new TextRun({ text, size: 24 })],
          spacing: { after: 240 },
        })
    )

    const doc = new Document({
      sections: [{ children: paragraphs }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cover-letter-${coverLetter?.company_name ?? "job"}.docx`
    a.click()
    URL.revokeObjectURL(url)

    if (coverLetterIdRef.current) {
      void fetch(`/api/cover-letter/${coverLetterIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ was_used: true }),
      })
    }
  }, [coverLetter?.body, coverLetter?.company_name])

  const generateVariantsFn = useCallback(async () => {
    if (isGeneratingVariants) return
    setIsGeneratingVariants(true)
    setError(null)

    try {
      const res = await fetch("/api/cover-letter/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, options }),
      })
      const data = (await res.json()) as CoverLetter[] | { error?: string }
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed")
      if (isMounted.current) setVariants(data as CoverLetter[])
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Failed to generate variants")
      }
    } finally {
      if (isMounted.current) setIsGeneratingVariants(false)
    }
  }, [isGeneratingVariants, jobId, options])

  const selectVariant = useCallback((variant: CoverLetter) => {
    setCoverLetter(variant)
    setVariants([])
  }, [])

  const toggleFavorite = useCallback(async () => {
    const id = coverLetterIdRef.current
    if (!id || !coverLetter) return
    const newValue = !coverLetter.is_favorite
    setCoverLetter((prev) => (prev ? { ...prev, is_favorite: newValue } : prev))
    await fetch(`/api/cover-letter/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: newValue }),
    })
  }, [coverLetter])

  return {
    coverLetter,
    setCoverLetter,
    isGenerating,
    isRegenerating,
    isGeneratingVariants,
    generatingMessage,
    options,
    updateOptions,
    generate,
    regenerateParagraph,
    updateBody,
    copyToClipboard,
    downloadTxt,
    downloadDocx,
    isCopied,
    error,
    variants,
    generateVariants: generateVariantsFn,
    selectVariant,
    toggleFavorite,
  }
}
