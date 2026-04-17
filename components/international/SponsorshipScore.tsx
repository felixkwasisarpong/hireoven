type ScoreTier = 'rare' | 'sometimes' | 'often' | 'active'

function getTier(score: number): ScoreTier {
  if (score >= 81) return 'active'
  if (score >= 61) return 'often'
  if (score >= 31) return 'sometimes'
  return 'rare'
}

const TIER: Record<ScoreTier, { label: string; dot: string; text: string; bg: string; bar: string; border: string }> = {
  active:    { label: 'Actively sponsors',  dot: 'bg-sky-500',   text: 'text-sky-700',   bg: 'bg-sky-50',    bar: 'bg-sky-500',   border: 'border-sky-200'   },
  often:     { label: 'Often sponsors',     dot: 'bg-blue-500',  text: 'text-blue-700',  bg: 'bg-blue-50',   bar: 'bg-[#0369A1]', border: 'border-blue-200'  },
  sometimes: { label: 'Sometimes sponsors', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50',  bar: 'bg-amber-500',  border: 'border-amber-200' },
  rare:      { label: 'Rarely sponsors',    dot: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-50',    bar: 'bg-red-500',    border: 'border-red-200'   },
}

interface SponsorshipScoreProps {
  score: number
  size?: 'sm' | 'md' | 'lg'
}

export default function SponsorshipScore({ score, size = 'md' }: SponsorshipScoreProps) {
  const cfg = TIER[getTier(score)]

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className={`text-xs font-semibold tabular-nums ${cfg.text}`}>{score}</span>
      </span>
    )
  }

  if (size === 'md') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    )
  }

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
        <span className={`text-2xl font-extrabold tabular-nums ${cfg.text}`}>{score}</span>
      </div>
      <div className="h-2 bg-white/60 rounded-full overflow-hidden">
        <div className={`h-full ${cfg.bar} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-2">Score 0–100 based on H1B petition history</p>
    </div>
  )
}
