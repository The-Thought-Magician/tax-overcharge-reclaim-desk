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

interface Vendor {
  id: string
  name: string
}

interface UseTaxEntry {
  id: string
  workspace_id: string
  vendor_id: string | null
  invoice_id: string | null
  period: string
  accrued_cents: number
  matched: boolean
  double_paid: boolean
  note: string | null
  created_at: string
}

interface ReconcileResult {
  matched: number
  double_paid: number
  entries: UseTaxEntry[]
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const STATUS_FILTERS = ['all', 'unmatched', 'matched', 'double_paid'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function UseTaxPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null)
  const [entries, setEntries] = useState<UseTaxEntry[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [periodFilter, setPeriodFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const [reconciling, setReconciling] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<UseTaxEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    period: '',
    vendor_id: '',
    invoice_id: '',
    accrued_dollars: '',
    note: '',
    matched: false,
    double_paid: false,
  })

  // Resolve a workspace id (persisted selection or first membership).
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
      const [es, vs] = await Promise.all([
        api.getUseTaxEntries(workspaceId, periodFilter || undefined),
        api.getVendors(workspaceId),
      ])
      setEntries(Array.isArray(es) ? es : [])
      setVendors(Array.isArray(vs) ? vs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load use-tax entries')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, periodFilter])

  useEffect(() => {
    load()
  }, [load])

  const vendorName = useCallback(
    (id: string | null) => (id ? vendors.find((v) => v.id === id)?.name ?? '—' : '—'),
    [vendors],
  )

  const periods = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.period) set.add(e.period)
    return Array.from(set).sort().reverse()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (statusFilter === 'unmatched' && (e.matched || e.double_paid)) return false
      if (statusFilter === 'matched' && !e.matched) return false
      if (statusFilter === 'double_paid' && !e.double_paid) return false
      if (q) {
        const hay = `${e.period} ${vendorName(e.vendor_id)} ${e.note ?? ''} ${e.invoice_id ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, statusFilter, search, vendorName])

  const totals = useMemo(() => {
    let accrued = 0
    let matched = 0
    let doublePaid = 0
    let doublePaidCents = 0
    for (const e of entries) {
      accrued += e.accrued_cents || 0
      if (e.matched) matched += 1
      if (e.double_paid) {
        doublePaid += 1
        doublePaidCents += e.accrued_cents || 0
      }
    }
    return { accrued, matched, doublePaid, doublePaidCents, count: entries.length }
  }, [entries])

  function openCreate() {
    setEditing(null)
    setFormErr(null)
    setForm({
      period: periodFilter || new Date().toISOString().slice(0, 7),
      vendor_id: '',
      invoice_id: '',
      accrued_dollars: '',
      note: '',
      matched: false,
      double_paid: false,
    })
    setFormOpen(true)
  }

  function openEdit(e: UseTaxEntry) {
    setEditing(e)
    setFormErr(null)
    setForm({
      period: e.period,
      vendor_id: e.vendor_id ?? '',
      invoice_id: e.invoice_id ?? '',
      accrued_dollars: (e.accrued_cents / 100).toString(),
      note: e.note ?? '',
      matched: e.matched,
      double_paid: e.double_paid,
    })
    setFormOpen(true)
  }

  async function saveEntry() {
    if (!workspaceId) return
    setFormErr(null)
    const dollars = parseFloat(form.accrued_dollars)
    if (!form.period.trim()) {
      setFormErr('Period is required (e.g. 2026-Q1 or 2026-06).')
      return
    }
    if (Number.isNaN(dollars)) {
      setFormErr('Accrued amount must be a number.')
      return
    }
    const payload = {
      workspace_id: workspaceId,
      period: form.period.trim(),
      vendor_id: form.vendor_id || null,
      invoice_id: form.invoice_id.trim() || null,
      accrued_cents: Math.round(dollars * 100),
      note: form.note.trim() || null,
      matched: form.matched,
      double_paid: form.double_paid,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateUseTaxEntry(editing.id, payload)
      } else {
        await api.createUseTaxEntry(payload)
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to save entry')
    } finally {
      setSaving(false)
    }
  }

  async function toggleMatched(e: UseTaxEntry) {
    try {
      await api.updateUseTaxEntry(e.id, { matched: !e.matched })
      setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, matched: !x.matched } : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update entry')
    }
  }

  async function runReconcile() {
    if (!workspaceId) return
    setReconciling(true)
    setError(null)
    try {
      const res: ReconcileResult = await api.reconcileUseTax({
        workspace_id: workspaceId,
        period: periodFilter || undefined,
      })
      setReconcileResult(res)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconciliation failed')
    } finally {
      setReconciling(false)
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
          <h1 className="text-2xl font-bold text-white">Use-Tax Reconciliation</h1>
          <p className="mt-1 text-sm text-slate-400">
            Worksheet of accrued use-tax. Match against vendor-charged tax and flag double payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={runReconcile} disabled={reconciling || !workspaceId}>
            {reconciling ? 'Reconciling…' : 'Run Reconciliation'}
          </Button>
          <Button onClick={openCreate} disabled={!workspaceId}>
            + New Entry
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Entries" value={totals.count} sub={`${periods.length} period(s)`} />
        <Stat label="Total Accrued" value={fmtUsd(totals.accrued)} tone="teal" />
        <Stat label="Matched" value={totals.matched} tone="green" sub={`of ${totals.count}`} />
        <Stat
          label="Double-Paid"
          value={totals.doublePaid}
          tone={totals.doublePaid > 0 ? 'rose' : 'default'}
          sub={fmtUsd(totals.doublePaidCents)}
        />
      </div>

      {reconcileResult && (
        <Card className="border-teal-800/60 bg-teal-950/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-teal-200">
              Reconciliation complete — <strong>{reconcileResult.matched}</strong> matched,{' '}
              <strong className={reconcileResult.double_paid > 0 ? 'text-rose-300' : ''}>
                {reconcileResult.double_paid}
              </strong>{' '}
              double-paid flagged across {reconcileResult.entries?.length ?? 0} entries.
            </div>
            <Button variant="ghost" onClick={() => setReconcileResult(null)}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search vendor, period, note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
          />
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            <option value="">All periods</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="py-16">
          <Spinner label="Loading use-tax entries…" />
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
          title={entries.length === 0 ? 'No use-tax entries yet' : 'No entries match your filters'}
          description={
            entries.length === 0
              ? 'Add accrued use-tax entries, then run reconciliation to detect double payments.'
              : 'Try clearing the search or status filter.'
          }
          action={
            entries.length === 0 ? (
              <Button onClick={openCreate}>+ New Entry</Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                  setPeriodFilter('')
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
              <TH>Period</TH>
              <TH>Vendor</TH>
              <TH>Invoice</TH>
              <TH className="text-right">Accrued</TH>
              <TH>Status</TH>
              <TH>Note</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((e) => (
              <TR key={e.id}>
                <TD className="font-medium text-slate-200">{e.period}</TD>
                <TD>{vendorName(e.vendor_id)}</TD>
                <TD className="font-mono text-xs text-slate-500">{e.invoice_id ?? '—'}</TD>
                <TD className="text-right tabular-nums text-slate-200">{fmtUsd(e.accrued_cents)}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {e.double_paid ? (
                      <Badge tone="rose">Double-paid</Badge>
                    ) : e.matched ? (
                      <Badge tone="green">Matched</Badge>
                    ) : (
                      <Badge tone="slate">Unmatched</Badge>
                    )}
                  </div>
                </TD>
                <TD className="max-w-[220px] truncate text-slate-400">{e.note ?? '—'}</TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggleMatched(e)}>
                      {e.matched ? 'Unmatch' : 'Match'}
                    </Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(e)}>
                      Edit
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Use-Tax Entry' : 'New Use-Tax Entry'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEntry} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create entry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {formErr}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">Period *</span>
              <input
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                placeholder="2026-Q1"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">Accrued (USD) *</span>
              <input
                type="number"
                step="0.01"
                value={form.accrued_dollars}
                onChange={(e) => setForm((f) => ({ ...f, accrued_dollars: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Vendor</span>
            <select
              value={form.vendor_id}
              onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
            >
              <option value="">— None —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Invoice ID</span>
            <input
              value={form.invoice_id}
              onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
              placeholder="optional"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Note</span>
            <textarea
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
            />
          </label>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.matched}
                onChange={(e) => setForm((f) => ({ ...f, matched: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-teal-600"
              />
              Matched
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.double_paid}
                onChange={(e) => setForm((f) => ({ ...f, double_paid: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-600"
              />
              Double-paid
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
