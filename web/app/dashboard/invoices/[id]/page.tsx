'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Invoice {
  id: string
  workspace_id: string
  vendor_id: string | null
  invoice_number: string
  invoice_date: string | null
  ship_to_state: string | null
  ship_to_county: string | null
  ship_to_city: string | null
  ship_to_zip: string | null
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  status: string
  source: string | null
}

interface Line {
  id: string
  line_number: number
  description: string | null
  gl_account: string | null
  category_id: string | null
  amount_cents: number
  tax_cents: number
  rate_charged: number | null
  jurisdiction_charged: string | null
  audit_result: string | null
  audit_reason: string | null
  recoverable_cents: number | null
}

interface Category {
  id: string
  name: string
  code?: string | null
}

function money(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function ratePct(r: number | null | undefined): string {
  if (r == null) return '—'
  // rate stored as fraction (e.g. 0.0875) or whole percent; normalize.
  const v = r > 1 ? r : r * 100
  return `${v.toFixed(3).replace(/\.?0+$/, '')}%`
}

function resultTone(result: string | null): 'rose' | 'amber' | 'green' | 'slate' | 'teal' {
  switch ((result || '').toLowerCase()) {
    case 'overcharged':
    case 'overpaid':
      return 'rose'
    case 'undercharged':
      return 'amber'
    case 'correct':
    case 'ok':
      return 'green'
    case 'exempt':
      return 'teal'
    default:
      return 'slate'
  }
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editLine, setEditLine] = useState<Line | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [editResult, setEditResult] = useState('')
  const [editReason, setEditReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const categoryName = useCallback(
    (cid: string | null) => categories.find((c) => c.id === cid)?.name ?? '—',
    [categories],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const inv = await api.getInvoice(id)
      // Endpoint returns { invoice, lines }; tolerate either shape.
      const invoiceObj: Invoice = inv?.invoice ?? inv
      let lineRows: Line[] = inv?.lines ?? []
      if (!Array.isArray(lineRows) || lineRows.length === 0) {
        lineRows = await api.getInvoiceLines(id)
      }
      setInvoice(invoiceObj ?? null)
      setLines(Array.isArray(lineRows) ? lineRows : [])
      const wsId = invoiceObj?.workspace_id
      if (wsId) {
        const cats = await api.getCategories(wsId)
        setCategories(Array.isArray(cats) ? cats : [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, l) => {
        acc.tax += l.tax_cents ?? 0
        acc.recoverable += l.recoverable_cents ?? 0
        if ((l.recoverable_cents ?? 0) > 0) acc.flagged += 1
        return acc
      },
      { tax: 0, recoverable: 0, flagged: 0 },
    )
  }, [lines])

  const openEdit = (line: Line) => {
    setEditLine(line)
    setEditCategory(line.category_id ?? '')
    setEditResult(line.audit_result ?? '')
    setEditReason(line.audit_reason ?? '')
    setEditError(null)
  }

  const saveLine = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editLine) return
    setSaving(true)
    setEditError(null)
    try {
      const updated: Line = await api.updateInvoiceLine(editLine.id, {
        category_id: editCategory || null,
        audit_result: editResult || null,
        audit_reason: editReason || null,
      })
      setLines((prev) => prev.map((l) => (l.id === editLine.id ? { ...l, ...updated } : l)))
      setEditLine(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update line')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner className="py-24" label="Loading invoice…" />

  if (error)
    return (
      <Card className="border-rose-900 p-6">
        <p className="text-sm text-rose-300">{error}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={load}>Retry</Button>
          <Link href="/dashboard/invoices">
            <Button variant="ghost">Back to invoices</Button>
          </Link>
        </div>
      </Card>
    )

  if (!invoice)
    return (
      <EmptyState
        title="Invoice not found"
        description="This invoice may have been deleted."
        action={
          <Link href="/dashboard/invoices">
            <Button variant="secondary">Back to invoices</Button>
          </Link>
        }
      />
    )

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/invoices" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Invoices
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Invoice {invoice.invoice_number || invoice.id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'No date'}
              {' · '}
              Ship-to {[invoice.ship_to_city, invoice.ship_to_county, invoice.ship_to_state].filter(Boolean).join(', ') || 'unknown'}
              {invoice.source && ` · via ${invoice.source}`}
            </p>
          </div>
          <Badge tone={invoice.status === 'flagged' ? 'rose' : invoice.status === 'audited' ? 'green' : 'teal'}>
            {invoice.status || 'unknown'}
          </Badge>
        </div>
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Subtotal" value={money(invoice.subtotal_cents)} />
        <Stat label="Tax Charged" value={money(invoice.tax_cents)} tone="amber" />
        <Stat label="Total" value={money(invoice.total_cents)} tone="teal" />
        <Stat label="Lines" value={lines.length} sub={`${totals.flagged} flagged`} />
        <Stat
          label="Recoverable"
          value={money(totals.recoverable)}
          tone={totals.recoverable > 0 ? 'rose' : 'green'}
          sub={totals.recoverable > 0 ? 'Overpaid tax' : 'No overcharge'}
        />
      </div>

      {/* Line-level audit results */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Line-Level Audit Results</h2>
          <span className="text-sm text-neutral-500">{money(totals.recoverable)} recoverable across this invoice</span>
        </div>
        {lines.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No line items"
              description="This invoice has no line items recorded. Import lines or add them via the API to run a line-level audit."
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-10">#</TH>
                <TH>Description</TH>
                <TH>Category</TH>
                <TH>Jurisdiction</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Tax</TH>
                <TH>Result</TH>
                <TH className="text-right">Recoverable</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.id}>
                  <TD className="text-neutral-500">{l.line_number}</TD>
                  <TD className="max-w-xs">
                    <div className="truncate font-medium text-neutral-100">{l.description || '—'}</div>
                    {l.gl_account && <div className="text-xs text-neutral-600">GL {l.gl_account}</div>}
                  </TD>
                  <TD>{categoryName(l.category_id)}</TD>
                  <TD>{l.jurisdiction_charged || '—'}</TD>
                  <TD className="text-right tabular-nums">{money(l.amount_cents)}</TD>
                  <TD className="text-right tabular-nums">{ratePct(l.rate_charged)}</TD>
                  <TD className="text-right tabular-nums">{money(l.tax_cents)}</TD>
                  <TD>
                    <div className="space-y-1">
                      <Badge tone={resultTone(l.audit_result)}>{l.audit_result || 'unaudited'}</Badge>
                      {l.audit_reason && <div className="max-w-[14rem] text-xs text-neutral-500">{l.audit_reason}</div>}
                    </div>
                  </TD>
                  <TD className={`text-right font-medium tabular-nums ${(l.recoverable_cents ?? 0) > 0 ? 'text-rose-300' : 'text-neutral-400'}`}>
                    {money(l.recoverable_cents)}
                  </TD>
                  <TD>
                    <button onClick={() => openEdit(l)} className="text-sm text-orange-400 hover:text-orange-300">
                      Edit
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Edit line modal */}
      <Modal
        open={!!editLine}
        onClose={() => setEditLine(null)}
        title={editLine ? `Edit Line ${editLine.line_number}` : 'Edit Line'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditLine(null)}>Cancel</Button>
            <Button variant="primary" form="line-form" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Line'}
            </Button>
          </>
        }
      >
        {editLine && (
          <form id="line-form" onSubmit={saveLine} className="space-y-4">
            {editError && <p className="rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-300">{editError}</p>}
            <p className="text-sm text-neutral-400">{editLine.description || 'Line item'}</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Category</span>
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className={inputClass}>
                <option value="">— Uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Audit Result (taxability override)</span>
              <select value={editResult} onChange={(e) => setEditResult(e.target.value)} className={inputClass}>
                <option value="">— Unaudited —</option>
                <option value="correct">Correct</option>
                <option value="overcharged">Overcharged</option>
                <option value="undercharged">Undercharged</option>
                <option value="exempt">Exempt</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Reason / Note</span>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={3}
                className={inputClass}
                placeholder="Why this line is correct, exempt, or overcharged…"
              />
            </label>
          </form>
        )}
      </Modal>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'
