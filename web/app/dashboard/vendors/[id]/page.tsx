'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Vendor {
  id: string
  workspace_id: string
  name: string
  dba: string | null
  tax_id: string | null
  default_state: string | null
  contact_email: string | null
  contact_name: string | null
  default_taxability: string | null
  risk_score: number | null
  aliases: string[] | null
  notes: string | null
  created_at: string
}

interface Invoice {
  id: string
  vendor_id: string
  invoice_number: string | null
  invoice_date: string | null
  ship_to_state: string | null
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  status: string | null
}

interface Finding {
  id: string
  invoice_id: string | null
  vendor_id: string | null
  type: string
  jurisdiction: string | null
  recoverable_cents: number
  reason: string | null
  confidence: number | null
  status: string | null
  transaction_date: string | null
  statute_deadline: string | null
  created_at: string
}

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function riskMeta(score: number | null): { tone: 'rose' | 'amber' | 'green' | 'slate'; label: string } {
  const s = score ?? 0
  if (s >= 0.66) return { tone: 'rose', label: 'High' }
  if (s >= 0.33) return { tone: 'amber', label: 'Medium' }
  if (s > 0) return { tone: 'green', label: 'Low' }
  return { tone: 'slate', label: 'None' }
}

const findingTone: Record<string, 'teal' | 'amber' | 'rose' | 'blue' | 'green' | 'slate'> = {
  overcharge: 'rose',
  wrong_rate: 'amber',
  exempt_charged: 'rose',
  double_paid: 'rose',
  freight_taxed: 'amber',
  labor_taxed: 'amber',
}

const statusTone: Record<string, 'teal' | 'amber' | 'rose' | 'blue' | 'green' | 'slate'> = {
  open: 'amber',
  confirmed: 'teal',
  claimed: 'blue',
  recovered: 'green',
  written_off: 'slate',
  dismissed: 'slate',
}

export default function VendorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')

  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    dba: '',
    tax_id: '',
    default_state: '',
    contact_email: '',
    contact_name: '',
    default_taxability: 'taxable',
    notes: '',
    aliases: '',
    risk_score: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const v: Vendor = await api.getVendor(id)
        if (!active) return
        setVendor(v)
        const [invs, finds] = await Promise.all([
          api.getInvoices(v.workspace_id).catch(() => []),
          api.getFindings({ workspaceId: v.workspace_id }).catch(() => []),
        ])
        if (!active) return
        setInvoices((Array.isArray(invs) ? invs : []).filter((iv: Invoice) => iv.vendor_id === id))
        setFindings((Array.isArray(finds) ? finds : []).filter((f: Finding) => f.vendor_id === id))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load vendor')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id])

  const totals = useMemo(() => {
    const invoiceTotal = invoices.reduce((s, i) => s + (i.total_cents || 0), 0)
    const taxTotal = invoices.reduce((s, i) => s + (i.tax_cents || 0), 0)
    const recoverable = findings.reduce((s, f) => s + (f.recoverable_cents || 0), 0)
    const openRecoverable = findings
      .filter((f) => f.status === 'open' || f.status === 'confirmed')
      .reduce((s, f) => s + (f.recoverable_cents || 0), 0)
    return { invoiceTotal, taxTotal, recoverable, openRecoverable }
  }, [invoices, findings])

  const byType = useMemo(() => {
    const m = new Map<string, { count: number; cents: number }>()
    for (const f of findings) {
      const cur = m.get(f.type) || { count: 0, cents: 0 }
      cur.count += 1
      cur.cents += f.recoverable_cents || 0
      m.set(f.type, cur)
    }
    const rows = Array.from(m.entries()).map(([type, v]) => ({ type, ...v }))
    rows.sort((a, b) => b.cents - a.cents)
    const max = rows.reduce((mx, r) => Math.max(mx, r.cents), 0)
    return { rows, max }
  }, [findings])

  function openEdit() {
    if (!vendor) return
    setForm({
      name: vendor.name || '',
      dba: vendor.dba || '',
      tax_id: vendor.tax_id || '',
      default_state: vendor.default_state || '',
      contact_email: vendor.contact_email || '',
      contact_name: vendor.contact_name || '',
      default_taxability: vendor.default_taxability || 'taxable',
      notes: vendor.notes || '',
      aliases: (vendor.aliases ?? []).join(', '),
      risk_score: vendor.risk_score != null ? String(vendor.risk_score) : '',
    })
    setFormError(null)
    setEditOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!vendor) return
    setSaving(true)
    setFormError(null)
    try {
      const aliases = form.aliases.split(',').map((a) => a.trim()).filter(Boolean)
      const riskNum = form.risk_score.trim() === '' ? null : Number(form.risk_score)
      const updated: Vendor = await api.updateVendor(vendor.id, {
        name: form.name.trim(),
        dba: form.dba.trim() || null,
        tax_id: form.tax_id.trim() || null,
        default_state: form.default_state.trim().toUpperCase() || null,
        contact_email: form.contact_email.trim() || null,
        contact_name: form.contact_name.trim() || null,
        default_taxability: form.default_taxability || null,
        notes: form.notes.trim() || null,
        aliases,
        risk_score: riskNum,
      })
      setVendor(updated)
      setEditOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update vendor')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading vendor…" />
      </div>
    )
  }

  if (error || !vendor) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="border-rose-900/60 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load vendor</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error || 'Vendor not found.'}</p>
        </Card>
        <Link href="/dashboard/vendors">
          <Button variant="secondary">← Back to vendors</Button>
        </Link>
      </div>
    )
  }

  const risk = riskMeta(vendor.risk_score)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/vendors" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Vendors
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">{vendor.name}</h1>
            <Badge tone={risk.tone}>Risk {risk.label} · {Math.round((vendor.risk_score ?? 0) * 100)}%</Badge>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {vendor.dba && <span>dba {vendor.dba} · </span>}
            {vendor.default_state || 'No state'} ·{' '}
            <span className="capitalize">{vendor.default_taxability || 'unknown'}</span>
            {vendor.tax_id && <span className="font-mono"> · {vendor.tax_id}</span>}
          </p>
          {(vendor.contact_name || vendor.contact_email) && (
            <p className="mt-0.5 text-sm text-neutral-500">
              {vendor.contact_name}
              {vendor.contact_name && vendor.contact_email ? ' · ' : ''}
              {vendor.contact_email}
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={openEdit}>Edit Vendor</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Invoices" value={invoices.length} tone="teal" />
        <Stat label="Tax Charged" value={fmtMoney(totals.taxTotal)} />
        <Stat label="Recoverable" value={fmtMoney(totals.recoverable)} tone="amber" />
        <Stat label="Open Recoverable" value={fmtMoney(totals.openRecoverable)} tone={totals.openRecoverable ? 'rose' : 'green'} />
      </div>

      {vendor.aliases && vendor.aliases.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Aliases</div>
          <div className="flex flex-wrap gap-2">
            {vendor.aliases.map((a) => (
              <Badge key={a} tone="slate">{a}</Badge>
            ))}
          </div>
        </Card>
      )}

      {vendor.notes && (
        <Card className="p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Notes</div>
          <p className="text-sm text-neutral-300 whitespace-pre-wrap">{vendor.notes}</p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Overcharge by Type</h2>
        {byType.rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No findings recorded for this vendor.</p>
        ) : (
          <div className="space-y-3">
            {byType.rows.map((r) => (
              <div key={r.type}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Badge tone={findingTone[r.type] || 'slate'}>{r.type.replace(/_/g, ' ')}</Badge>
                    <span className="text-neutral-500">{r.count} finding{r.count === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tabular-nums font-medium text-neutral-200">{fmtMoney(r.cents)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-orange-500"
                    style={{ width: `${byType.max ? Math.max(4, (r.cents / byType.max) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Overcharge History (Findings)</h2>
        {findings.length === 0 ? (
          <EmptyState icon="✅" title="No findings" description="No tax overcharges have been flagged for this vendor." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Jurisdiction</TH>
                <TH>Reason</TH>
                <TH>Txn Date</TH>
                <TH>Status</TH>
                <TH className="text-right">Recoverable</TH>
              </TR>
            </THead>
            <TBody>
              {findings
                .slice()
                .sort((a, b) => (b.recoverable_cents || 0) - (a.recoverable_cents || 0))
                .map((f) => (
                  <TR key={f.id}>
                    <TD><Badge tone={findingTone[f.type] || 'slate'}>{f.type.replace(/_/g, ' ')}</Badge></TD>
                    <TD>{f.jurisdiction || <span className="text-neutral-600">—</span>}</TD>
                    <TD className="max-w-xs truncate text-neutral-400">{f.reason || '—'}</TD>
                    <TD>{fmtDate(f.transaction_date)}</TD>
                    <TD><Badge tone={statusTone[f.status || ''] || 'slate'}>{(f.status || 'open').replace(/_/g, ' ')}</Badge></TD>
                    <TD className="text-right tabular-nums font-medium text-amber-300">{fmtMoney(f.recoverable_cents)}</TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Invoices</h2>
        {invoices.length === 0 ? (
          <EmptyState icon="🧾" title="No invoices" description="No invoices from this vendor yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Invoice #</TH>
                <TH>Date</TH>
                <TH>Ship To</TH>
                <TH>Status</TH>
                <TH className="text-right">Subtotal</TH>
                <TH className="text-right">Tax</TH>
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((iv) => (
                <TR key={iv.id}>
                  <TD>
                    <Link href={`/dashboard/invoices/${iv.id}`} className="font-medium text-orange-300 hover:text-orange-200">
                      {iv.invoice_number || iv.id.slice(0, 8)}
                    </Link>
                  </TD>
                  <TD>{fmtDate(iv.invoice_date)}</TD>
                  <TD>{iv.ship_to_state || <span className="text-neutral-600">—</span>}</TD>
                  <TD><Badge tone="slate">{iv.status || 'pending'}</Badge></TD>
                  <TD className="text-right tabular-nums">{fmtMoney(iv.subtotal_cents)}</TD>
                  <TD className="text-right tabular-nums">{fmtMoney(iv.tax_cents)}</TD>
                  <TD className="text-right tabular-nums font-medium text-neutral-200">{fmtMoney(iv.total_cents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Vendor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button form="vendor-edit-form" type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <form id="vendor-edit-form" onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="DBA">
              <input value={form.dba} onChange={(e) => setForm({ ...form, dba: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Tax ID">
              <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default State">
              <input value={form.default_state} onChange={(e) => setForm({ ...form, default_state: e.target.value })} maxLength={2} className={inputCls} />
            </Field>
            <Field label="Default Taxability">
              <select value={form.default_taxability} onChange={(e) => setForm({ ...form, default_taxability: e.target.value })} className={inputCls}>
                <option value="taxable">Taxable</option>
                <option value="exempt">Exempt</option>
                <option value="mixed">Mixed</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact Name">
              <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Contact Email">
              <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Risk Score" hint="0.0–1.0">
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={form.risk_score}
                onChange={(e) => setForm({ ...form, risk_score: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Aliases" hint="comma separated">
              <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-orange-500 focus:outline-none'

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-400">
        {label}
        {required && <span className="text-rose-400"> *</span>}
        {hint && <span className="ml-1 text-neutral-600">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
