'use client'
import { useMemo } from 'react'
import Link from 'next/link'
import type { VisaStatus } from '@/types'

interface OPTCountdownProps {
  optEndDate: string | null
  visaStatus: VisaStatus | null
  compact?: boolean
}

type Urgency = 'safe' | 'watch' | 'hurry' | 'urgent'

const URGENCY: Record<Urgency, { bg: string; border: string; text: string; bar: string; message: string }> = {
  safe:   { bg: 'bg-[#FFF7F2]',    border: 'border-[#FFD2B8]',    text: 'text-[#9A3412]',    bar: 'bg-[#FFB088]',    message: 'You have time. Apply strategically.' },
  watch:  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  bar: 'bg-amber-500',  message: 'Start prioritizing fast-moving companies.' },
  hurry:  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', bar: 'bg-orange-500', message: 'Focus on companies with quick processes.' },
  urgent: { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    bar: 'bg-red-500',    message: 'Urgent. Target companies with cap-gap support.' },
}

function getUrgency(days: number): Urgency {
  if (days > 120) return 'safe'
  if (days > 60) return 'watch'
  if (days > 30) return 'hurry'
  return 'urgent'
}

export default function OPTCountdown({ optEndDate, visaStatus, compact = false }: OPTCountdownProps) {
  const days = useMemo(() => {
    if (!optEndDate) return null
    const ms = new Date(optEndDate).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / 86_400_000))
  }, [optEndDate])

  if (!optEndDate || days === null) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-400 mb-2">OPT end date not set</p>
        <Link href="/dashboard/profile" className="text-xs text-[#FF5C18] font-medium hover:underline">
          Set your OPT date →
        </Link>
      </div>
    )
  }

  const urgency = getUrgency(days)
  const cfg = URGENCY[urgency]
  const isStem = visaStatus === 'stem_opt'
  const label = isStem ? 'STEM OPT' : 'OPT'
  const elapsed = Math.min(1, Math.max(0, 1 - days / 365))

  if (compact) {
    return (
      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-xs font-semibold ${cfg.text}`}>{label} Countdown</span>
          <span className={`text-xl font-bold tabular-nums ${cfg.text}`}>{days}d</span>
        </div>
        <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div className={`h-full ${cfg.bar} rounded-full`} style={{ width: `${elapsed * 100}%` }} />
        </div>
        <p className={`text-xs mt-1.5 ${cfg.text} opacity-80`}>{cfg.message}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border-2 ${cfg.border} ${cfg.bg} p-6`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label} Countdown</p>
          <p className={`text-6xl font-extrabold tabular-nums mt-1 ${cfg.text}`}>{days}</p>
          <p className="text-sm text-gray-500 mt-0.5">days remaining</p>
        </div>
        {isStem && (
          <span className="px-2.5 py-1 bg-[#FFF1E8] text-[#ea580c] text-xs font-semibold rounded-full border border-[#FFD9C2]">
            STEM OPT
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="h-3 bg-white/60 rounded-full overflow-hidden">
          <div className={`h-full ${cfg.bar} rounded-full transition-all duration-1000`} style={{ width: `${elapsed * 100}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Expires {new Date(optEndDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <p className={`text-sm font-semibold ${cfg.text}`}>{cfg.message}</p>
    </div>
  )
}
