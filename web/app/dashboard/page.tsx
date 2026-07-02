'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { useWorkspace } from '@/lib/useWorkspace'
import { Card } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Overview {
  total_claimable_cents: number
  total_recovered_cents: number
  recovery_rate: number
  at_risk_cents: number
  leakage_rate: number
}

interface Alert {
  type: string
  severity?: string
  title: string
  detail?: string
  amount_cents?: number
  link?: string
  date?: string
}

interface Finding {
  id: string
  type: string
  jurisdiction?: string | null
  recoverable_cents: number
  reason?: string | null
  status: string
  confidence?: number | null
  transaction_date?: string | null
  statute_deadline?: string | null
}

function money(cents: number | null | undefined): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(n: number | null | undefined): string {
  return `${Math.round((n ?? 0) * 100)}%`
}

function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const d = new Date(date).getTime()
  if (Number.isNaN(d)) return null
  return Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24))
}

function alertTone(severity?: string, type?: string): 'rose' | 'amber' | 'teal' | 'slate' {
  const s = (severity || '').toLowerCase()
  if (s === 'high' || s === 'critical') return 'rose'
  if (s === 'medium' || s === 'warning') return 'amber'
  if (type?.includes('statute')) return 'amber'
  return 'teal'
}

export default function DashboardPage() {
  const { workspaceId, loading: wsLoading, error: wsError } = useWorkspace()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [expiring, setExpiring] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const [ov, al, ex] = await Promise.all([
        api.getAnalyticsOverview(ws),
        api.getAlerts(ws),
        api.getExpiringFindings(ws, 90),
      ])
      setOverview(ov ?? null)
      setAlerts(Array.isArray(al) ? al : [])
      setExpiring(Array.isArray(ex) ? ex : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  // Group expiring findings into statute buckets.
  const buckets = useMemo(() => {
    const defs = [
      { label: 'Overdue', min: -Infinity, max: 0, tone: 'rose' as const },
      { label: '≤ 30 days', min: 0, max: 30, tone: 'rose' as const },
      { label: '31-60 days', min: 30, max: 60, tone: 'amber' as const },
      { label: '61-90 days', min: 60, max: 90, tone: 'teal' as const },
    ]
    const out = defs.map((d) => ({ ...d, count: 0, cents: 0 }))
    for (const f of expiring) {
      const d = daysUntil(f.statute_deadline)
      if (d === null) continue
      const b = out.find((x) => d > x.min && d <= x.max) ?? (d <= 0 ? out[0] : null)
      if (b) {
        b.count += 1
        b.cents += f.recoverable_cents ?? 0
      }
    }
    return out
  }, [expiring])

  const maxBucketCents = Math.max(1, ...buckets.map((b) => b.cents))
  const expiringTotal = expiring.reduce((s, f) => s + (f.recoverable_cents ?? 0), 0)

  if (wsLoading) {
    return <Spinner className="py-24" label="Loading workspace…" />
  }
  if (wsError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-rose-300">{wsError}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Recovery Overview</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Overpaid sales and use tax you can still claim back, ranked by statute risk.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/audit">
            <Button variant="primary">Run Audit</Button>
          </Link>
          <Link href="/dashboard/findings">
            <Button variant="secondary">View Findings</Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="border-rose-900 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-rose-300">{error}</p>
            {workspaceId && (
              <Button variant="secondary" onClick={() => load(workspaceId)}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner className="py-24" label="Loading metrics…" />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat
              label="Total Claimable"
              value={money(overview?.total_claimable_cents)}
              sub="Identified overcharges"
              tone="teal"
            />
            <Stat
              label="Recovered"
              value={money(overview?.total_recovered_cents)}
              sub="Cash returned to date"
              tone="green"
            />
            <Stat
              label="Recovery Rate"
              value={pct(overview?.recovery_rate)}
              sub="Recovered / claimable"
            />
            <Stat
              label="At Risk"
              value={money(overview?.at_risk_cents)}
              sub="Nearing statute deadline"
              tone="amber"
            />
            <Stat
              label="Leakage Rate"
              value={pct(overview?.leakage_rate)}
              sub="Overpaid / total tax"
              tone="rose"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* At-risk by statute */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">At Risk by Statute Window</h2>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {money(expiringTotal)} recoverable across {expiring.length} findings
                  </p>
                </div>
                <Link href="/dashboard/statute" className="text-sm text-orange-400 hover:text-orange-300">
                  Statute clock →
                </Link>
              </div>
              <div className="mt-5 space-y-4">
                {buckets.every((b) => b.count === 0) ? (
                  <EmptyState
                    title="Nothing expiring soon"
                    description="No findings are within 90 days of a statute-of-limitations deadline."
                  />
                ) : (
                  buckets.map((b) => (
                    <div key={b.label}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-neutral-300">
                          <Badge tone={b.tone}>{b.label}</Badge>
                          <span className="text-neutral-500">{b.count} findings</span>
                        </span>
                        <span className="font-medium tabular-nums text-neutral-200">{money(b.cents)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className={
                            b.tone === 'rose'
                              ? 'h-full rounded-full bg-rose-500'
                              : b.tone === 'amber'
                                ? 'h-full rounded-full bg-amber-500'
                                : 'h-full rounded-full bg-orange-500'
                          }
                          style={{ width: `${Math.max(b.cents > 0 ? 6 : 0, (b.cents / maxBucketCents) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Alerts feed */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Alerts</h2>
                <Badge tone={alerts.length > 0 ? 'amber' : 'slate'}>{alerts.length} active</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {alerts.length === 0 ? (
                  <EmptyState title="All clear" description="No expiring certificates, statute risks, or high-value findings right now." />
                ) : (
                  alerts.slice(0, 12).map((a, i) => {
                    const tone = alertTone(a.severity, a.type)
                    const body = (
                      <div className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 transition-colors hover:border-neutral-700">
                        <span
                          className={
                            tone === 'rose'
                              ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-400'
                              : tone === 'amber'
                                ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400'
                                : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-400'
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-neutral-200">{a.title}</p>
                            {a.amount_cents != null && (
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-300">
                                {money(a.amount_cents)}
                              </span>
                            )}
                          </div>
                          {a.detail && <p className="mt-0.5 truncate text-xs text-neutral-500">{a.detail}</p>}
                          <div className="mt-1 flex items-center gap-2">
                            <Badge tone={tone}>{a.type?.replace(/[_-]/g, ' ') || 'alert'}</Badge>
                            {a.date && <span className="text-xs text-neutral-600">{new Date(a.date).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      </div>
                    )
                    return a.link ? (
                      <Link key={i} href={a.link.startsWith('/') ? a.link : `/dashboard/${a.link}`} className="block">
                        {body}
                      </Link>
                    ) : (
                      <div key={i}>{body}</div>
                    )
                  })
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
