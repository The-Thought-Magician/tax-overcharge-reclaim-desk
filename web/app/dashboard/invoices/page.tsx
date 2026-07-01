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
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Vendor {
  id: string
  name: string
}

interface Invoice {
  id: string
  vendor_id: string | null
  invoice_number: string
  invoice_date: string | null
  ship_to_state: string | null
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  status: string
  source: string | null
  created_at?: string
}

interface DuplicateGroup {
  invoice_number?: string
  vendor_id?: string
  count?: number
  invoice_ids?: string[]
  ids?: string[]
}

function money(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function statusTone(status: string): 'teal' | 'amber' | 'green' | 'slate' | 'rose' {
  switch ((status || '').toLowerCase()) {
    case 'audited':
      return 'green'
    case 'flagged':
      return 'rose'
    case 'pending':
      return 'amber'
    case 'imported':
      return 'teal'
    default:
      return 'slate'
  }
}

const STATUSES = ['', 'imported', 'pending', 'audited', 'flagged']

const emptyForm = {
  vendor_id: '',
  invoice_number: '',
  invoice_date: '',
  ship_to_state: '',
  ship_to_county: '',
  ship_to_city: '',
  ship_to_zip: '',
  subtotal: '',
  tax: '',
  source: 'manual',
}

export default function InvoicesPage() {
  const { workspaceId, loading: wsLoading, error: wsError } = useWorkspace()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null)
  const [checkingDupes, setCheckingDupes] = useState(false)

  const vendorName = useCallback(
    (id: string | null) => vendors.find((v) => v.id === id)?.name ?? '—',
    [vendors],
  )

  const load = useCallback(
    async (ws: string, status?: string) => {
      setLoading(true)
      setError(null)
      try {
        const [inv, vs] = await Promise.all([
          api.getInvoices(ws, status || undefined),
          api.getVendors(ws),
        ])
        setInvoices(Array.isArray(inv) ? inv : [])
        setVendors(Array.isArray(vs) ? vs : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load invoices')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (workspaceId) load(workspaceId, statusFilter)
  }, [workspaceId, statusFilter, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(
      (i) =>
        i.invoice_number?.toLowerCase().includes(q) ||
        vendorName(i.vendor_id).toLowerCase().includes(q) ||
        (i.ship_to_state || '').toLowerCase().includes(q),
    )
  }, [invoices, search, vendorName])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, i) => {
        acc.tax += i.tax_cents ?? 0
        acc.total += i.total_cents ?? 0
        return acc
      },
      { tax: 0, total: 0 },
    )
  }, [filtered])

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    try {
      const subtotalCents = Math.round(parseFloat(form.subtotal || '0') * 100)
      const taxCents = Math.round(parseFloat(form.tax || '0') * 100)
      await api.createInvoice({
        workspace_id: workspaceId,
        vendor_id: form.vendor_id || null,
        invoice_number: form.invoice_number,
        invoice_date: form.invoice_date || null,
        ship_to_state: form.ship_to_state || null,
        ship_to_county: form.ship_to_county || null,
        ship_to_city: form.ship_to_city || null,
        ship_to_zip: form.ship_to_zip || null,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: subtotalCents + taxCents,
        source: form.source || 'manual',
        lines:
          subtotalCents > 0
            ? [
                {
                  line_number: 1,
                  amount_cents: subtotalCents,
                  tax_cents: taxCents,
                  rate_charged: subtotalCents > 0 ? taxCents / subtotalCents : 0,
                  jurisdiction_charged: form.ship_to_state || null,
                },
              ]
            : undefined,
      })
      setCreateOpen(false)
      setForm(emptyForm)
      await load(workspaceId, statusFilter)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  const submitImport = async () => {
    if (!workspaceId) return
    setImporting(true)
    setImportMsg(null)
    try {
      const parsed = JSON.parse(importText)
      const rows = Array.isArray(parsed) ? parsed : parsed.invoices
      if (!Array.isArray(rows)) throw new Error('Expected a JSON array of invoices')
      const res = await api.importInvoices({ workspace_id: workspaceId, invoices: rows })
      const n = res?.imported ?? rows.length
      setImportMsg(`Imported ${n} invoice${n === 1 ? '' : 's'}.`)
      await load(workspaceId, statusFilter)
    } catch (e) {
      setImportMsg(e instanceof Error ? `Error: ${e.message}` : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const runDuplicateCheck = async () => {
    if (!workspaceId) return
    setCheckingDupes(true)
    setError(null)
    try {
      const res = await api.checkDuplicateInvoices({ workspace_id: workspaceId })
      const groups = res?.duplicates ?? res ?? []
      setDupes(Array.isArray(groups) ? groups : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate check failed')
    } finally {
      setCheckingDupes(false)
    }
  }

  const sampleImport = `[
  {
    "invoice_number": "INV-2001",
    "vendor_id": ${vendors[0] ? `"${vendors[0].id}"` : 'null'},
    "invoice_date": "2026-01-15",
    "ship_to_state": "CA",
    "subtotal_cents": 100000,
    "tax_cents": 9000,
    "total_cents": 109000
  }
]`

  if (wsLoading) return <Spinner className="py-24" label="Loading workspace…" />
  if (wsError)
    return (
      <Card className="p-6">
        <p className="text-sm text-rose-300">{wsError}</p>
      </Card>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="mt-1 text-sm text-slate-400">
            AP invoices feeding the overcharge audit. Import, dedupe, and drill into line-level results.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={runDuplicateCheck} disabled={checkingDupes}>
            {checkingDupes ? 'Checking…' : 'Check Duplicates'}
          </Button>
          <Button variant="secondary" onClick={() => { setImportOpen(true); setImportMsg(null) }}>
            Import
          </Button>
          <Button variant="primary" onClick={() => { setCreateOpen(true); setFormError(null) }}>
            New Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Invoices" value={filtered.length} sub={search || statusFilter ? 'Filtered' : 'All'} />
        <Stat label="Tax Charged" value={money(totals.tax)} tone="amber" />
        <Stat label="Total Billed" value={money(totals.total)} tone="teal" />
      </div>

      {dupes && (
        <Card className="border-amber-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-200">
              Duplicate check: {dupes.length} group{dupes.length === 1 ? '' : 's'} found
            </h2>
            <button onClick={() => setDupes(null)} className="text-xs text-slate-500 hover:text-slate-300">
              Dismiss
            </button>
          </div>
          {dupes.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No duplicate invoices detected.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {dupes.map((g, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
                  <span className="text-slate-200">
                    {g.invoice_number ? `#${g.invoice_number}` : 'Group'}{' '}
                    {g.vendor_id && <span className="text-slate-500">· {vendorName(g.vendor_id)}</span>}
                  </span>
                  <Badge tone="amber">{g.count ?? (g.invoice_ids || g.ids || []).length} copies</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {error && (
        <Card className="border-rose-900 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-rose-300">{error}</p>
            {workspaceId && (
              <Button variant="secondary" onClick={() => load(workspaceId, statusFilter)}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice #, vendor, or state…"
          className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
        />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-teal-600/20 text-teal-300'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner className="py-20" label="Loading invoices…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={invoices.length === 0 ? 'No invoices yet' : 'No invoices match your filters'}
          description={
            invoices.length === 0
              ? 'Import a batch of AP invoices or add one manually to start auditing for overcharged tax.'
              : 'Try clearing the search or status filter.'
          }
          action={
            invoices.length === 0 ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setImportOpen(true)}>Import</Button>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>New Invoice</Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Invoice #</TH>
              <TH>Vendor</TH>
              <TH>Date</TH>
              <TH>Ship-to</TH>
              <TH className="text-right">Subtotal</TH>
              <TH className="text-right">Tax</TH>
              <TH className="text-right">Total</TH>
              <TH>Status</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((inv) => (
              <TR key={inv.id}>
                <TD className="font-medium text-slate-100">
                  <Link href={`/dashboard/invoices/${inv.id}`} className="hover:text-teal-300">
                    {inv.invoice_number || inv.id.slice(0, 8)}
                  </Link>
                </TD>
                <TD>{vendorName(inv.vendor_id)}</TD>
                <TD>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}</TD>
                <TD>{inv.ship_to_state || '—'}</TD>
                <TD className="text-right tabular-nums">{money(inv.subtotal_cents)}</TD>
                <TD className="text-right tabular-nums">{money(inv.tax_cents)}</TD>
                <TD className="text-right font-medium tabular-nums text-slate-100">{money(inv.total_cents)}</TD>
                <TD>
                  <Badge tone={statusTone(inv.status)}>{inv.status || 'unknown'}</Badge>
                </TD>
                <TD>
                  <Link href={`/dashboard/invoices/${inv.id}`} className="text-sm text-teal-400 hover:text-teal-300">
                    Audit →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Invoice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" form="invoice-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Create Invoice'}
            </Button>
          </>
        }
      >
        <form id="invoice-form" onSubmit={submitCreate} className="space-y-4">
          {formError && <p className="rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-300">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice #" required>
              <input
                required
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Vendor">
              <select
                value={form.vendor_id}
                onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                className={inputClass}
              >
                <option value="">— Select —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invoice Date">
              <input
                type="date"
                value={form.invoice_date}
                onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Ship-to State">
              <input
                value={form.ship_to_state}
                onChange={(e) => setForm({ ...form, ship_to_state: e.target.value.toUpperCase().slice(0, 2) })}
                placeholder="CA"
                className={inputClass}
              />
            </Field>
            <Field label="Ship-to City">
              <input value={form.ship_to_city} onChange={(e) => setForm({ ...form, ship_to_city: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Ship-to ZIP">
              <input value={form.ship_to_zip} onChange={(e) => setForm({ ...form, ship_to_zip: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Subtotal ($)">
              <input
                type="number"
                step="0.01"
                value={form.subtotal}
                onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Tax Charged ($)">
              <input
                type="number"
                step="0.01"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* Import modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Invoices"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Close</Button>
            <Button variant="primary" onClick={submitImport} disabled={importing || !importText.trim()}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Paste a JSON array of invoice rows. Cents fields are integers. Each row may include line items.
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            placeholder={sampleImport}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setImportText(sampleImport)}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            Insert sample row
          </button>
          {importMsg && (
            <p className={`text-sm ${importMsg.startsWith('Error') ? 'text-rose-300' : 'text-emerald-300'}`}>
              {importMsg}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-teal-500 focus:outline-none'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label} {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
    </label>
  )
}
