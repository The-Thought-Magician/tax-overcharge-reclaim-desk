import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'teal' | 'green' | 'amber' | 'rose' | 'slate' | 'blue'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-slate-800 text-slate-300 border-slate-700',
  slate: 'bg-slate-800 text-slate-300 border-slate-700',
  teal: 'bg-teal-950 text-teal-300 border-teal-800',
  green: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  amber: 'bg-amber-950 text-amber-300 border-amber-800',
  rose: 'bg-rose-950 text-rose-300 border-rose-800',
  blue: 'bg-sky-950 text-sky-300 border-sky-800',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
