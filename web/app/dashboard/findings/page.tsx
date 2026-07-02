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

interface Finding {
  id: string
  workspace_id: string
  audit_run_id: string | null
  invoice_id: string | null
  invoice_line_id: string | null
  vendor_id: string | null
  type: string
  jurisdiction: string | null
  recoverable_cents: number
  reason: string | null
  confidence: number | null
  status: string
  transaction_date: string | null
  statute_deadline: string | null
  created_at: string
  updated_at: string | null
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { dateStyle: 'medium' })
}

// Status pipeline stages.
const PIPELINE = ['new', 'reviewing', 'confirmed', 'claimed', 'recovered', 'rejected', 'written_off'] as const
type Status = (typeof PIPELINE)[number]

const STATUS_TONE: Record<string, 'slate' | 'teal' | 'amber' | 'green' | 'rose' | 'blue'> = {
  new: 'blue',
  reviewing: 'amber',
  confirmed: 'teal',
  claimed: 'teal',
  recovered: 'green',
  rejected: 'rose',
  written_off: 'slate',
}

function statusTone(s: string) {
  return STATUS_TONE[(s || '').toLowerCase()] ?? 'slate'
}

function confidenceTone(c: number | null): 'green' | 'amber' | 'rose' {
  const v = c ?? 0
  if (v >= 0.8) return 'green'
  if (v >= 0.5) return 'amber'
  return 'rose'
}

export default function FindingsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [vendors, setVendors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Finding | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Claim creation modal.
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimSaving, setClaimSaving] = useState(false)
  const [claimErr, setClaimErr] = useState<string | null>(null)
  const [claimForm, setClaimForm] = useState({
    claim_type: 'refund',
    jurisdiction: '',
    reference_number: '',
    note: '',
  })

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
      const [fs, vs] = await Promise.all([
        api.getFindings({
          workspaceId,
          type: typeFilter || undefined,
          status: statusFilter || undefined,
        }),
        api.getVendors(workspaceId),
      ])
      setFindings(Array.isArray(fs) ? fs : [])
      const map: Record<string, string> = {}
      if (Array.isArray(vs)) for (const v of vs as { id: string; name: string }[]) map[v.id] = v.name
      setVendors(map)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load findings')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, typeFilter, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const types = useMemo(() => Array.from(new Set(findings.map((f) => f.type).filter(Boolean))).sort(), [findings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return findings
    return findings.filter((f) => {
      const hay = `${f.type} ${f.jurisdiction ?? ''} ${f.reason ?? ''} ${vendors[f.vendor_id ?? ''] ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [findings, search, vendors])

  const stats = useMemo(() => {
    let recoverable = 0
    const byStatus: Record<string, number> = {}
    for (const f of findings) {
      recoverable += f.recoverable_cents || 0
      const s = (f.status || 'new').toLowerCase()
      byStatus[s] = (byStatus[s] || 0) + 1
    }
    return { recoverable, byStatus, count: findings.length }
  }, [findings])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((f) => f.id))))
  }

  function withBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function setStatus(id: string, status: string) {
    withBusy(id, true)
    try {
      const updated: Finding = await api.updateFinding(id, { status })
      setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...updated } : f)))
      if (detail?.id === id) setDetail((d) => (d ? { ...d, ...updated } : d))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update finding')
    } finally {
      withBusy(id, false)
    }
  }

  async function bulkSetStatus(status: string) {
    const ids = Array.from(selected)
    for (const id of ids) {
      // sequential to keep request shape simple and avoid overload
      // eslint-disable-next-line no-await-in-loop
      await setStatus(id, status)
    }
    setSelected(new Set())
  }

  async function reaudit(id: string) {
    withBusy(id, true)
    try {
      const updated: Finding = await api.reauditFinding(id)
      setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...updated } : f)))
      if (detail?.id === id) setDetail((d) => (d ? { ...d, ...updated } : d))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-audit failed')
    } finally {
      withBusy(id, false)
    }
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d: Finding = await api.getFinding(id)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const selectedFindings = useMemo(
    () => findings.filter((f) => selected.has(f.id)),
    [findings, selected],
  )

  const selectedTotal = useMemo(
    () => selectedFindings.reduce((sum, f) => sum + (f.recoverable_cents || 0), 0),
    [selectedFindings],
  )

  function openClaim() {
    if (selected.size === 0) return
    // default jurisdiction to the common one across the selection, if any
    const jurs = new Set(selectedFindings.map((f) => f.jurisdiction).filter(Boolean) as string[])
    setClaimForm({
      claim_type: 'refund',
      jurisdiction: jurs.size === 1 ? Array.from(jurs)[0] : '',
      reference_number: '',
      note: '',
    })
    setClaimErr(null)
    setClaimOpen(true)
  }

  async function createClaim() {
    if (!workspaceId || selected.size === 0) return
    setClaimSaving(true)
    setClaimErr(null)
    const ids = Array.from(selected)
    const firstVendor = selectedFindings.find((f) => f.vendor_id)?.vendor_id ?? null
    try {
      await api.createClaim({
        workspace_id: workspaceId,
        vendor_id: firstVendor,
        claim_type: claimForm.claim_type,
        jurisdiction: claimForm.jurisdiction.trim() || null,
        reference_number: claimForm.reference_number.trim() || null,
        note: claimForm.note.trim() || null,
        expected_cents: selectedTotal,
        finding_ids: ids,
      })
      setClaimOpen(false)
      // mark the bundled findings as claimed
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await api.updateFinding(id, { status: 'claimed' }).catch(() => null)
      }
      await load()
    } catch (e) {
      setClaimErr(e instanceof Error ? e.message : 'Failed to create claim')
    } finally {
      setClaimSaving(false)
    }
  }

  if (workspaceErr) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState title="Workspace unavailable" description={workspaceErr} />
      </div>
    )
  }

  const allChecked = filtered.length > 0 && selected.size === filtered.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Findings Ledger</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Overcharge findings from audit runs. Triage through the recovery pipeline and bundle into claims.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Findings" value={stats.count} />
        <Stat label="Recoverable" value={fmtUsd(stats.recoverable)} tone="teal" />
        <Stat
          label="Recovered"
          value={stats.byStatus['recovered'] || 0}
          tone="green"
          sub="findings"
        />
        <Stat
          label="Open"
          value={(stats.byStatus['new'] || 0) + (stats.byStatus['reviewing'] || 0)}
          tone="amber"
          sub="new + reviewing"
        />
      </div>

      {/* Pipeline bar */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Status Pipeline</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter('')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === '' ? 'border-orange-600 bg-orange-600/15 text-orange-300' : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            All ({stats.count})
          </button>
          {PIPELINE.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? 'border-orange-600 bg-orange-600/15 text-orange-300'
                  : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {s.replace('_', ' ')} ({stats.byStatus[s] || 0})
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search type, vendor, jurisdiction, reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-orange-800/60 bg-orange-950/20 p-4">
          <div className="text-sm text-orange-200">
            <strong>{selected.size}</strong> selected — {fmtUsd(selectedTotal)} recoverable
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => bulkSetStatus('reviewing')}>
              Mark Reviewing
            </Button>
            <Button variant="secondary" onClick={() => bulkSetStatus('confirmed')}>
              Mark Confirmed
            </Button>
            <Button variant="secondary" onClick={() => bulkSetStatus('rejected')}>
              Reject
            </Button>
            <Button onClick={openClaim}>Create Claim</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="py-16">
          <Spinner label="Loading findings…" />
        </div>
      ) : error ? (
        <Card className="border-rose-800/60 bg-rose-950/20 p-6">
          <p className="text-sm text-rose-300">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={findings.length === 0 ? 'No findings yet' : 'No findings match your filters'}
          description={
            findings.length === 0
              ? 'Run an audit to surface overcharged tax as recoverable findings.'
              : 'Try clearing the search, type, or status filter.'
          }
          action={
            findings.length === 0 ? (
              <a href="/dashboard/audit">
                <Button>Go to Audit Runs</Button>
              </a>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setTypeFilter('')
                  setStatusFilter('')
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-orange-600"
                />
              </TH>
              <TH>Type</TH>
              <TH>Vendor</TH>
              <TH>Jurisdiction</TH>
              <TH className="text-right">Recoverable</TH>
              <TH className="text-right">Confidence</TH>
              <TH>Status</TH>
              <TH>Statute</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((f) => {
              const busy = busyIds.has(f.id)
              return (
                <TR key={f.id}>
                  <TD>
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggleSelect(f.id)}
                      aria-label={`Select finding ${f.id}`}
                      className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-orange-600"
                    />
                  </TD>
                  <TD>
                    <button
                      onClick={() => openDetail(f.id)}
                      className="font-medium text-neutral-200 hover:text-orange-300"
                    >
                      {f.type}
                    </button>
                  </TD>
                  <TD>{f.vendor_id ? vendors[f.vendor_id] ?? '—' : '—'}</TD>
                  <TD>{f.jurisdiction ?? '—'}</TD>
                  <TD className="text-right tabular-nums text-orange-300">{fmtUsd(f.recoverable_cents)}</TD>
                  <TD className="text-right">
                    <Badge tone={confidenceTone(f.confidence)}>
                      {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : '—'}
                    </Badge>
                  </TD>
                  <TD>
                    <select
                      value={(f.status || 'new').toLowerCase()}
                      disabled={busy}
                      onChange={(e) => setStatus(f.id, e.target.value)}
                      className={`rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs capitalize text-neutral-200 focus:border-orange-500 focus:outline-none`}
                    >
                      {PIPELINE.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </TD>
                  <TD className="whitespace-nowrap text-neutral-400">{fmtDate(f.statute_deadline)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={busy}
                        onClick={() => reaudit(f.id)}
                      >
                        {busy ? '…' : 'Re-audit'}
                      </Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openDetail(f.id)}>
                        View
                      </Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* Finding detail modal */}
      <Modal open={detailId !== null} onClose={() => setDetailId(null)} title="Finding Detail">
        {detailLoading ? (
          <div className="py-8">
            <Spinner label="Loading finding…" />
          </div>
        ) : !detail ? (
          <p className="text-sm text-neutral-500">Could not load this finding.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold text-white">{detail.type}</span>
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Recoverable</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-orange-300">
                  {fmtUsd(detail.recoverable_cents)}
                </div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Confidence</div>
                <div className="mt-1">
                  <Badge tone={confidenceTone(detail.confidence)}>
                    {detail.confidence != null ? `${Math.round(detail.confidence * 100)}%` : '—'}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Vendor</div>
                <div className="mt-1 text-neutral-200">
                  {detail.vendor_id ? vendors[detail.vendor_id] ?? detail.vendor_id : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Jurisdiction</div>
                <div className="mt-1 text-neutral-200">{detail.jurisdiction ?? '—'}</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Transaction date</div>
                <div className="mt-1 text-neutral-200">{fmtDate(detail.transaction_date)}</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Statute deadline</div>
                <div className="mt-1 text-neutral-200">{fmtDate(detail.statute_deadline)}</div>
              </div>
            </div>
            {detail.reason && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-xs uppercase text-neutral-500">Reason</div>
                <p className="mt-1 text-sm text-neutral-300">{detail.reason}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <select
                value={(detail.status || 'new').toLowerCase()}
                onChange={(e) => setStatus(detail.id, e.target.value)}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm capitalize text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {PIPELINE.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={busyIds.has(detail.id)}
                onClick={() => reaudit(detail.id)}
              >
                {busyIds.has(detail.id) ? 'Re-auditing…' : 'Re-audit'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setStatus(detail.id, 'written_off')}
                disabled={busyIds.has(detail.id)}
              >
                Write off
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create claim modal */}
      <Modal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        title="Create Refund Claim"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClaimOpen(false)} disabled={claimSaving}>
              Cancel
            </Button>
            <Button onClick={createClaim} disabled={claimSaving}>
              {claimSaving ? 'Creating…' : `Create claim (${fmtUsd(selectedTotal)})`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {claimErr && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {claimErr}
            </div>
          )}
          <p className="text-sm text-neutral-400">
            Bundling <strong className="text-neutral-200">{selected.size}</strong> finding(s) worth{' '}
            <strong className="text-orange-300">{fmtUsd(selectedTotal)}</strong> into a single claim.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Claim type</span>
              <select
                value={claimForm.claim_type}
                onChange={(e) => setClaimForm((f) => ({ ...f, claim_type: e.target.value }))}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="refund">Refund (jurisdiction)</option>
                <option value="vendor_credit">Vendor credit</option>
                <option value="amended_return">Amended return</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Jurisdiction</span>
              <input
                value={claimForm.jurisdiction}
                onChange={(e) => setClaimForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                placeholder="e.g. CA"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-400">Reference number</span>
            <input
              value={claimForm.reference_number}
              onChange={(e) => setClaimForm((f) => ({ ...f, reference_number: e.target.value }))}
              placeholder="optional"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-400">Note</span>
            <textarea
              value={claimForm.note}
              onChange={(e) => setClaimForm((f) => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
