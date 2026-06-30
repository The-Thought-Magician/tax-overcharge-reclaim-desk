'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface AuditRun {
  id: string
  workspace_id: string
  scope: string | null
  lines_scanned: number
  findings_count: number
  total_recoverable_cents: number
  status: string
  created_by: string | null
  created_at: string
}

interface RunResult {
  run: AuditRun
  findings_count: number
  total_recoverable_cents: number
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusTone(status: string): 'green' | 'amber' | 'rose' | 'slate' | 'teal' {
  switch ((status || '').toLowerCase()) {
    case 'complete':
    case 'completed':
    case 'done':
      return 'green'
    case 'running':
    case 'pending':
      return 'amber'
    case 'failed':
    case 'error':
      return 'rose'
    default:
      return 'slate'
  }
}

const SCOPES = [
  { value: 'full', label: 'Full audit (all invoice lines)' },
  { value: 'unaudited', label: 'Unaudited lines only' },
  { value: 'recent', label: 'Recent invoices' },
]

export default function AuditPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null)
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState<string | null>(null)
  const [scope, setScope] = useState('full')
  const [lastResult, setLastResult] = useState<RunResult | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditRun | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.getWorkspaces()
        if (!active) return
        if (!ws || ws.length === 0) {
          setWorkspaceErr('No workspace found. Create one in Settings to begin.')
          setLoading(false)
          return
        }
        const stored = typeof window !== 'undefined' ? localStorage.getItem('torch.workspaceId') : null
        const chosen = (stored && ws.find((w) => w.id === stored)?.id) || ws[0].id
        setWorkspaceId(chosen)
      } catch (e) {
        if (!active) return
        setWorkspaceErr(e instanceof Error ? e.message : 'Failed to load workspace')
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const rs: AuditRun[] = await api.getAuditRuns(workspaceId)
      setRuns(Array.isArray(rs) ? rs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit runs')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    let lines = 0
    let findings = 0
    let recoverable = 0
    for (const r of runs) {
      lines += r.lines_scanned || 0
      findings += r.findings_count || 0
      recoverable += r.total_recoverable_cents || 0
    }
    const last = runs[0]
    return { lines, findings, recoverable, count: runs.length, last }
  }, [runs])

  const maxRecoverable = useMemo(
    () => Math.max(1, ...runs.map((r) => r.total_recoverable_cents || 0)),
    [runs],
  )

  async function runNow() {
    if (!workspaceId) return
    setRunning(true)
    setRunErr(null)
    try {
      const res: RunResult = await api.runAudit({ workspace_id: workspaceId, scope })
      setLastResult(res)
      await load()
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Audit run failed')
    } finally {
      setRunning(false)
    }
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d: AuditRun = await api.getAuditRun(id)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  if (workspaceErr) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState title="Workspace unavailable" description={workspaceErr} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Runs</h1>
          <p className="mt-1 text-sm text-slate-400">
            Scan invoice lines for overcharged indirect tax and generate recoverable findings.
          </p>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-[260px] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-400">Audit scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={running}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
            >
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={runNow} disabled={running || !workspaceId}>
            {running ? 'Running audit…' : 'Run Audit'}
          </Button>
        </div>
        {runErr && <p className="mt-3 text-sm text-rose-300">{runErr}</p>}
        {lastResult && (
          <div className="mt-4 rounded-lg border border-teal-800/60 bg-teal-950/20 p-4 text-sm text-teal-200">
            Audit complete — scanned <strong>{lastResult.run?.lines_scanned ?? 0}</strong> lines, found{' '}
            <strong>{lastResult.findings_count}</strong> findings worth{' '}
            <strong className="text-teal-300">{fmtUsd(lastResult.total_recoverable_cents)}</strong> recoverable.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Runs" value={stats.count} />
        <Stat label="Lines Scanned" value={stats.lines.toLocaleString()} tone="teal" />
        <Stat label="Findings" value={stats.findings.toLocaleString()} tone="amber" />
        <Stat label="Recoverable" value={fmtUsd(stats.recoverable)} tone="green" />
      </div>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Recoverable per Run
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs to chart yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-slate-500">{fmtDate(r.created_at)}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full rounded bg-gradient-to-r from-teal-600 to-teal-400"
                    style={{
                      width: `${Math.max(2, ((r.total_recoverable_cents || 0) / maxRecoverable) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-teal-300">
                  {fmtUsd(r.total_recoverable_cents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Run History</h2>
        {loading ? (
          <div className="py-16">
            <Spinner label="Loading audit runs…" />
          </div>
        ) : error ? (
          <Card className="border-rose-800/60 bg-rose-950/20 p-6">
            <p className="text-sm text-rose-300">{error}</p>
            <Button variant="secondary" className="mt-3" onClick={load}>
              Retry
            </Button>
          </Card>
        ) : runs.length === 0 ? (
          <EmptyState
            title="No audit runs yet"
            description="Run your first audit to scan invoice lines and surface recoverable overcharges."
            action={
              <Button onClick={runNow} disabled={running || !workspaceId}>
                Run Audit
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Scope</TH>
                <TH>Status</TH>
                <TH className="text-right">Lines</TH>
                <TH className="text-right">Findings</TH>
                <TH className="text-right">Recoverable</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-slate-200">{fmtDate(r.created_at)}</TD>
                  <TD className="capitalize">{r.scope ?? 'full'}</TD>
                  <TD>
                    <Badge tone={statusTone(r.status)}>{r.status || 'unknown'}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{(r.lines_scanned || 0).toLocaleString()}</TD>
                  <TD className="text-right tabular-nums">{(r.findings_count || 0).toLocaleString()}</TD>
                  <TD className="text-right tabular-nums text-teal-300">{fmtUsd(r.total_recoverable_cents)}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openDetail(r.id)}>
                        Details
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <Modal open={detailId !== null} onClose={() => setDetailId(null)} title="Audit Run Detail">
        {detailLoading ? (
          <div className="py-8">
            <Spinner label="Loading run…" />
          </div>
        ) : !detail ? (
          <p className="text-sm text-slate-500">Could not load this run.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-slate-500">{detail.id}</span>
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase text-slate-500">Scope</div>
                <div className="mt-1 capitalize text-slate-200">{detail.scope ?? 'full'}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase text-slate-500">Run at</div>
                <div className="mt-1 text-slate-200">{fmtDate(detail.created_at)}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase text-slate-500">Lines scanned</div>
                <div className="mt-1 tabular-nums text-slate-200">
                  {(detail.lines_scanned || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase text-slate-500">Findings</div>
                <div className="mt-1 tabular-nums text-amber-300">
                  {(detail.findings_count || 0).toLocaleString()}
                </div>
              </div>
              <div className="col-span-2 rounded-lg border border-teal-800/60 bg-teal-950/20 p-3">
                <div className="text-xs uppercase text-teal-400">Total recoverable</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-teal-300">
                  {fmtUsd(detail.total_recoverable_cents)}
                </div>
              </div>
            </div>
            <a
              href="/dashboard/findings"
              className="block text-center text-sm font-medium text-teal-400 hover:text-teal-300"
            >
              View findings from this scan →
            </a>
          </div>
        )}
      </Modal>
    </div>
  )
}
