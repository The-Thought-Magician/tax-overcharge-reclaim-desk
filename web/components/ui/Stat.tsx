import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'teal' | 'green' | 'amber' | 'rose'
  className?: string
}

const valueTones: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-white',
  teal: 'text-teal-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
}

export function Stat({ label, value, sub, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 p-5 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {sub != null && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  )
}

export default Stat
