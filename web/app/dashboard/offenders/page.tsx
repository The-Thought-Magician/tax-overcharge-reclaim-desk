'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'torc.activeWorkspaceId'

interface OffenderRow {
  vendor_id?: string
  vendor_name?: string
  vendor?: { id?: string; name?: string } | string
  total_overcharge_cents: number
  finding_count: number
  by_type?: Record<string, number> | { type: string; recoverable_cents: number; count?: number }[]
}

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function vendorId(r: OffenderRow): string | undefined {
  if (r.vendor_id) return r.vendor_id
  if (typeof r.vendor === 'object' && r.vendor) return r.vendor.id
  return undefined
}

function vendorName(r: OffenderRow): string {
  if (r.vendor_name) return r.vendor_name
  if (typeof r.vendor === 'string') return r.vendor
  if (typeof r.vendor === 'object' && r.vendor?.name) return r.vendor.name
  return vendorId(r)?.slice(0, 8) || 'Unknown vendor'
}

// Normalise by_type into [{ type, cents }] regardless of shape.
function normaliseByType(by: OffenderRow['by_type']): { type: string; cents: number }[] {
  if (!by) return []
  if (Array.isArray(by)) {
    return by.map((e) => ({ type: e.type, cents: e.recoverable_cents || 0 }))
  }
  return Object.entries(by).map(([type, cents]) => ({ type, cents: Number(cents) || 0 }))
}

const typeColors: Record<string, string> = {
  overcharge: 'bg-rose-500',
  wrong_rate: 'bg-amber-500',
  exempt_charged: 'bg-fuchsia-500',
  double_paid: 'bg-orange-500',
  freight_taxed: 'bg-sky-500',
  labor_taxed: 'bg-orange-500',
  saas_taxed: 'bg-violet-500',
}

function colorFor(type: string, idx: number): string {
  if (typeColors[type]) return typeColors[type]
  const fallback = ['bg-orange-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-emerald-500']
  return fallback[idx % fallback.length]
}

export default function OffendersPage() {
  const [offenders, setOffenders] = useState<OffenderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'amount' | 'count'>('amount')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let wsId = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const workspaces = await api.getWorkspaces()
        if (!Array.isArray(workspaces) || workspaces.length === 0) {
          if (active) {
            setError('No workspace found. Create one in Settings first.')
            setLoading(false)
          }
          return
        }
        if (!wsId || !workspaces.some((w: { id: string }) => w.id === wsId)) {
          wsId = workspaces[0].id
          if (typeof window !== 'undefined' && wsId) localStorage.setItem(WS_KEY, wsId)
        }
        const rows = await api.getOffenders(wsId as string)
        if (!active) return
        setOffenders(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load offenders')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Collect all observed types across offenders for the legend.
  const allTypes = useMemo(() => {
    const set = new Set<string>()
    for (const r of offenders) for (const t of normaliseByType(r.by_type)) set.add(t.type)
    return Array.from(set).sort()
  }, [offenders])

  const ranked = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = offenders.filter((r) => !q || vendorName(r).toLowerCase().includes(q))
    const sorted = filtered.slice().sort((a, b) =>
      sortBy === 'amount'
        ? (b.total_overcharge_cents || 0) - (a.total_overcharge_cents || 0)
        : (b.finding_count || 0) - (a.finding_count || 0),
    )
    return sorted
  }, [offenders, search, sortBy])

  const max = useMemo(
    () => offenders.reduce((m, r) => Math.max(m, r.total_overcharge_cents || 0), 0),
    [offenders],
  )

  const stats = useMemo(() => {
    const totalCents = offenders.reduce((s, r) => s + (r.total_overcharge_cents || 0), 0)
    const totalFindings = offenders.reduce((s, r) => s + (r.finding_count || 0), 0)
    const worst = offenders.reduce<OffenderRow | null>(
      (w, r) => (!w || (r.total_overcharge_cents || 0) > (w.total_overcharge_cents || 0) ? r : w),
      null,
    )
    return { offenderCount: offenders.length, totalCents, totalFindings, worst }
  }, [offenders])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading repeat offenders…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900/60 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load offenders</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Repeat Offenders</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Vendors ranked by total tax overcharged, with a breakdown of finding types.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Offending Vendors" value={stats.offenderCount} tone="rose" />
        <Stat label="Total Overcharged" value={fmtMoney(stats.totalCents)} tone="amber" />
        <Stat label="Total Findings" value={stats.totalFindings} tone="teal" />
        <Stat label="Worst Offender" value={stats.worst ? vendorName(stats.worst) : '—'} sub={stats.worst ? fmtMoney(stats.worst.total_overcharge_cents) : undefined} />
      </div>

      {offenders.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="No repeat offenders"
          description="No vendors have flagged overcharges yet. Run an audit to populate this ranking."
          action={<Link href="/dashboard/audit"><Button>Go to Audit Runs</Button></Link>}
        />
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vendor…"
                className="min-w-[220px] flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-orange-500 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'amount' | 'count')}
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
                >
                  <option value="amount">Overcharge amount</option>
                  <option value="count">Finding count</option>
                </select>
              </div>
            </div>
            {allTypes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-neutral-800 pt-3">
                {allTypes.map((t, i) => (
                  <span key={t} className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <span className={`inline-block h-2.5 w-2.5 rounded-sm ${colorFor(t, i)}`} />
                    {t.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {ranked.length === 0 ? (
            <EmptyState icon="🔍" title="No matches" description="No vendors match your search." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>Vendor</TH>
                  <TH>By Type</TH>
                  <TH className="text-right">Findings</TH>
                  <TH className="text-right">Total Overcharge</TH>
                </TR>
              </THead>
              <TBody>
                {ranked.map((r, rank) => {
                  const types = normaliseByType(r.by_type)
                  const segTotal = types.reduce((s, t) => s + t.cents, 0) || r.total_overcharge_cents || 1
                  const vid = vendorId(r)
                  return (
                    <TR key={vid || rank}>
                      <TD className="text-neutral-500 tabular-nums">{rank + 1}</TD>
                      <TD>
                        {vid ? (
                          <Link href={`/dashboard/vendors/${vid}`} className="font-medium text-orange-300 hover:text-orange-200">
                            {vendorName(r)}
                          </Link>
                        ) : (
                          <span className="font-medium text-neutral-200">{vendorName(r)}</span>
                        )}
                        {rank === 0 && <Badge tone="rose" className="ml-2">Top offender</Badge>}
                      </TD>
                      <TD>
                        <div className="min-w-[180px]">
                          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
                            {types.length === 0 ? (
                              <div className="h-full w-full bg-neutral-700" />
                            ) : (
                              types
                                .slice()
                                .sort((a, b) => b.cents - a.cents)
                                .map((t, i) => (
                                  <div
                                    key={t.type}
                                    className={`h-full ${colorFor(t.type, allTypes.indexOf(t.type) >= 0 ? allTypes.indexOf(t.type) : i)}`}
                                    style={{ width: `${(t.cents / segTotal) * 100}%` }}
                                    title={`${t.type.replace(/_/g, ' ')}: ${fmtMoney(t.cents)}`}
                                  />
                                ))
                            )}
                          </div>
                          {types.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                              {types
                                .slice()
                                .sort((a, b) => b.cents - a.cents)
                                .slice(0, 4)
                                .map((t) => (
                                  <span key={t.type}>
                                    {t.type.replace(/_/g, ' ')} {fmtMoney(t.cents)}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-neutral-300">{r.finding_count}</TD>
                      <TD className="text-right">
                        <div className="font-semibold tabular-nums text-amber-300">{fmtMoney(r.total_overcharge_cents)}</div>
                        <div className="mt-1 ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-neutral-800">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${max ? Math.max(4, ((r.total_overcharge_cents || 0) / max) * 100) : 0}%` }}
                          />
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}
