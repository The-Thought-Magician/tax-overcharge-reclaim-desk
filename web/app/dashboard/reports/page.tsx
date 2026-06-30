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

type ReportKind = 'findings' | 'recovery' | 'scorecard'

type Row = Record<string, unknown>

const TABS: { id: ReportKind; label: string; desc: string }[] = [
  { id: 'findings', label: 'Findings Export', desc: 'Line-level overcharge findings ready for filing.' },
  { id: 'recovery', label: 'Recovery Summary', desc: 'Recovered vs claimable by period.' },
  { id: 'scorecard', label: 'Vendor Scorecard', desc: 'Per-vendor overcharge and recovery performance.' },
]

const FINDING_TYPES = ['', 'overcharge', 'wrong_rate', 'exempt_taxed', 'double_paid', 'freight_taxed', 'labor_taxed']
const FINDING_STATUSES = ['', 'open', 'under_review', 'claimed', 'recovered', 'written_off', 'dismissed']

function fmtUSD(cents: unknown): string {
  const n = typeof cents === 'number' ? cents : Number(cents)
  if (Number.isNaN(n)) return '—'
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function isCentsKey(k: string): boolean {
  return /_cents$/.test(k)
}

function prettyHeader(k: string): string {
  return k
    .replace(/_cents$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function renderCell(k: string, v: unknown): string {
  if (v == null) return '—'
  if (isCentsKey(k)) return fmtUSD(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function toCsv(rows: Row[], columns: string[]): string {
  const esc = (val: unknown): string => {
    const s = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = columns.map(esc).join(',')
  const body = rows
    .map((r) => columns.map((c) => esc(isCentsKey(c) ? (r[c] == null ? '' : Number(r[c]) / 100) : r[c])).join(','))
    .join('\n')
  return `${header}\n${body}`
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [tab, setTab] = useState<ReportKind>('findings')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

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
        setLoading(false)
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

  const load = useCallback(
    async (wid: string, kind: ReportKind, t: string, s: string) => {
      setTableLoading(true)
      setError(null)
      try {
        let data: unknown
        if (kind === 'findings') {
          data = await api.getFindingsReport({ workspaceId: wid, type: t || undefined, status: s || undefined })
        } else if (kind === 'recovery') {
          data = await api.getRecoveryReport(wid)
        } else {
          data = await api.getVendorScorecard(wid)
        }
        setRows(Array.isArray(data) ? (data as Row[]) : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load report')
        setRows([])
      } finally {
        setTableLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (workspaceId) load(workspaceId, tab, typeFilter, statusFilter)
  }, [workspaceId, tab, typeFilter, statusFilter, load])

  // Derive columns from data
  const columns = useMemo(() => {
    if (rows.length === 0) return []
    const set = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) set.add(k)
    return Array.from(set)
  }, [rows])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const exportCsv = () => {
    if (filtered.length === 0) return
    const csv = toCsv(filtered, columns)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`torq-${tab}-${stamp}.csv`, csv)
  }

  // Summary stats per tab
  const summary = useMemo(() => {
    if (rows.length === 0) return null
    if (tab === 'findings') {
      const total = rows.reduce((s, r) => s + (Number(r.recoverable_cents) || 0), 0)
      return [
        { label: 'Findings', value: rows.length, tone: 'teal' as const },
        { label: 'Total Recoverable', value: fmtUSD(total), tone: 'teal' as const },
      ]
    }
    if (tab === 'recovery') {
      const claimable = rows.reduce((s, r) => s + (Number(r.claimable_cents ?? r.recoverable_cents) || 0), 0)
      const recovered = rows.reduce((s, r) => s + (Number(r.recovered_cents) || 0), 0)
      return [
        { label: 'Periods', value: rows.length, tone: 'default' as const },
        { label: 'Claimable', value: fmtUSD(claimable), tone: 'teal' as const },
        { label: 'Recovered', value: fmtUSD(recovered), tone: 'green' as const },
      ]
    }
    const vendors = rows.length
    const overcharge = rows.reduce((s, r) => s + (Number(r.total_overcharge_cents ?? r.overcharge_cents ?? r.recoverable_cents) || 0), 0)
    return [
      { label: 'Vendors', value: vendors, tone: 'default' as const },
      { label: 'Total Overcharge', value: fmtUSD(overcharge), tone: 'rose' as const },
    ]
  }, [rows, tab])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading reports…" />
      </div>
    )
  }

  if (error === 'NO_WORKSPACE') {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings to generate recovery reports."
          icon={<span>📄</span>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">{TABS.find((t) => t.id === tab)?.desc}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => workspaceId && load(workspaceId, tab, typeFilter, statusFilter)}
          >
            Refresh
          </Button>
          <Button onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex flex-wrap rounded-lg border border-slate-700 bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              setSearch('')
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {summary.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} />
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rows…"
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
          />
          {tab === 'findings' && (
            <>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
              >
                {FINDING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === '' ? 'All types' : prettyHeader(t)}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
              >
                {FINDING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === '' ? 'All statuses' : prettyHeader(s)}
                  </option>
                ))}
              </select>
            </>
          )}
          <Badge tone="slate">{filtered.length} rows</Badge>
        </div>
      </Card>

      {/* Table */}
      {error ? (
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load report</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => workspaceId && load(workspaceId, tab, typeFilter, statusFilter)}
          >
            Retry
          </Button>
        </Card>
      ) : tableLoading ? (
        <Spinner className="py-16" label="Loading report data…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No rows to report"
          description={
            rows.length > 0
              ? 'No rows match your search or filters.'
              : 'Run an audit and file claims to populate this report.'
          }
          icon={<span>🗂️</span>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((c) => (
                <TH key={c} className={isCentsKey(c) ? 'text-right' : ''}>
                  {prettyHeader(c)}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {filtered.map((r, i) => (
              <TR key={(r.id as string) ?? i}>
                {columns.map((c) => (
                  <TD
                    key={c}
                    className={`${isCentsKey(c) ? 'text-right tabular-nums' : ''} ${
                      isCentsKey(c) ? 'text-teal-300' : ''
                    }`}
                  >
                    {renderCell(c, r[c])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
