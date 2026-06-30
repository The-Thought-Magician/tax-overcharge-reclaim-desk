'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import Card from '@/components/ui/card'
import Stat from '@/components/ui/Stat'
import Badge from '@/components/ui/Badge'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import Button from '@/components/ui/button'

interface Overview {
  total_claimable_cents: number
  total_recovered_cents: number
  recovery_rate: number
  at_risk_cents: number
  leakage_rate: number
}

interface BreakdownRow {
  key: string
  label?: string
  recoverable_cents?: number
  recovered_cents?: number
  finding_count?: number
  count?: number
}

type Dimension = 'type' | 'vendor' | 'jurisdiction' | 'period'

const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'type', label: 'By Type' },
  { id: 'vendor', label: 'By Vendor' },
  { id: 'jurisdiction', label: 'By Jurisdiction' },
  { id: 'period', label: 'By Period' },
]

const BAR_COLORS = [
  '#2dd4bf', '#38bdf8', '#34d399', '#fbbf24', '#fb7185',
  '#a78bfa', '#f472b6', '#22d3ee', '#facc15', '#4ade80',
]

function fmtUSD(cents: number | undefined | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPct(rate: number | undefined | null): string {
  if (rate == null || Number.isNaN(rate)) return '0%'
  // accept either fraction (0-1) or already-percent values
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

function rowLabel(r: BreakdownRow): string {
  return r.label ?? r.key ?? '—'
}

function rowValue(r: BreakdownRow): number {
  return r.recoverable_cents ?? r.recovered_cents ?? 0
}

function rowCount(r: BreakdownRow): number {
  return r.finding_count ?? r.count ?? 0
}

export default function AnalyticsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [dimension, setDimension] = useState<Dimension>('type')
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolve workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws = await api.getWorkspaces()
        if (!active) return
        const list = Array.isArray(ws) ? ws : []
        if (list.length === 0) {
          setError('NO_WORKSPACE')
          setLoading(false)
          return
        }
        const stored = typeof window !== 'undefined' ? localStorage.getItem('torq_workspace_id') : null
        const chosen = list.find((w: { id: string }) => w.id === stored)?.id ?? list[0].id
        setWorkspaceId(chosen)
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const loadOverview = useCallback(async (wid: string) => {
    setLoading(true)
    setError(null)
    try {
      const ov = await api.getAnalyticsOverview(wid)
      setOverview(ov)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBreakdown = useCallback(async (wid: string, dim: Dimension) => {
    setBreakdownLoading(true)
    try {
      const rows = await api.getAnalyticsBreakdown(wid, dim)
      setBreakdown(Array.isArray(rows) ? rows : [])
    } catch {
      setBreakdown([])
    } finally {
      setBreakdownLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) loadOverview(workspaceId)
  }, [workspaceId, loadOverview])

  useEffect(() => {
    if (workspaceId) loadBreakdown(workspaceId, dimension)
  }, [workspaceId, dimension, loadBreakdown])

  const maxValue = useMemo(
    () => Math.max(1, ...breakdown.map((r) => rowValue(r))),
    [breakdown],
  )
  const totalValue = useMemo(
    () => breakdown.reduce((s, r) => s + rowValue(r), 0),
    [breakdown],
  )

  if (loading && !overview) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading recovery analytics…" />
      </div>
    )
  }

  if (error === 'NO_WORKSPACE') {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings and seed sample data to see recovery analytics."
          icon={<span>📊</span>}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load analytics</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => workspaceId && loadOverview(workspaceId)}
          >
            Retry
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Recovery Analytics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Overcharge leakage, claimable exposure, and recovery performance.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (workspaceId) {
              loadOverview(workspaceId)
              loadBreakdown(workspaceId, dimension)
            }
          }}
        >
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Total Claimable"
          value={fmtUSD(overview?.total_claimable_cents)}
          tone="teal"
          sub="Recoverable across findings"
        />
        <Stat
          label="Total Recovered"
          value={fmtUSD(overview?.total_recovered_cents)}
          tone="green"
          sub="Cash returned from claims"
        />
        <Stat
          label="Recovery Rate"
          value={fmtPct(overview?.recovery_rate)}
          tone="teal"
          sub="Recovered ÷ claimable"
        />
        <Stat
          label="At Risk"
          value={fmtUSD(overview?.at_risk_cents)}
          tone="amber"
          sub="Nearing statute deadline"
        />
        <Stat
          label="Leakage Rate"
          value={fmtPct(overview?.leakage_rate)}
          tone="rose"
          sub="Overcharge vs spend"
        />
      </div>

      {/* Recovery progress bar */}
      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Recovery Progress</h2>
          <span className="text-xs text-slate-500">
            {fmtUSD(overview?.total_recovered_cents)} of {fmtUSD(overview?.total_claimable_cents)}
          </span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-600 to-emerald-400 transition-all"
            style={{
              width: `${Math.min(
                100,
                ((overview?.total_recovered_cents ?? 0) /
                  Math.max(1, overview?.total_claimable_cents ?? 0)) *
                  100,
              )}%`,
            }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>Recovered</span>
          <span>Outstanding claimable</span>
        </div>
      </Card>

      {/* Breakdown */}
      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Recoverable Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Distribution of recoverable exposure by dimension.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-1">
            {DIMENSIONS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDimension(d.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  dimension === d.id
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {breakdownLoading ? (
          <Spinner className="py-10" label="Loading breakdown…" />
        ) : breakdown.length === 0 ? (
          <EmptyState
            title="No breakdown data"
            description="Run an audit to generate findings before analytics can group them."
            icon={<span>🧮</span>}
          />
        ) : (
          <div className="space-y-6">
            {/* SVG-free horizontal bar chart */}
            <div className="space-y-3">
              {breakdown.map((r, i) => {
                const val = rowValue(r)
                const pct = (val / maxValue) * 100
                return (
                  <div key={r.key ?? i}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="truncate font-medium text-slate-300">{rowLabel(r)}</span>
                      <span className="tabular-nums text-slate-400">{fmtUSD(val)}</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Distribution composition bar */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Composition
              </div>
              <div className="flex h-6 w-full overflow-hidden rounded-lg">
                {breakdown.map((r, i) => {
                  const val = rowValue(r)
                  const pct = totalValue > 0 ? (val / totalValue) * 100 : 0
                  if (pct <= 0) return null
                  return (
                    <div
                      key={`seg-${r.key ?? i}`}
                      title={`${rowLabel(r)} — ${fmtUSD(val)}`}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                      }}
                    />
                  )
                })}
              </div>
            </div>

            {/* Detail table */}
            <Table>
              <THead>
                <TR>
                  <TH>{DIMENSIONS.find((d) => d.id === dimension)?.label.replace('By ', '')}</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH className="text-right">Findings</TH>
                  <TH className="text-right">Share</TH>
                </TR>
              </THead>
              <TBody>
                {breakdown.map((r, i) => {
                  const val = rowValue(r)
                  const share = totalValue > 0 ? (val / totalValue) * 100 : 0
                  return (
                    <TR key={`row-${r.key ?? i}`}>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                          />
                          {rowLabel(r)}
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums text-teal-300">{fmtUSD(val)}</TD>
                      <TD className="text-right tabular-nums">{rowCount(r)}</TD>
                      <TD className="text-right">
                        <Badge tone="slate">{share.toFixed(1)}%</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
