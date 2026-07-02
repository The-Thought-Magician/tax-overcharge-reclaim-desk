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
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'torc.activeWorkspaceId'

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

function riskTone(score: number | null): 'rose' | 'amber' | 'green' | 'slate' {
  const s = score ?? 0
  if (s >= 0.66) return 'rose'
  if (s >= 0.33) return 'amber'
  if (s > 0) return 'green'
  return 'slate'
}

function riskLabel(score: number | null): string {
  const s = score ?? 0
  if (s >= 0.66) return 'High'
  if (s >= 0.33) return 'Medium'
  if (s > 0) return 'Low'
  return 'None'
}

const emptyForm = {
  name: '',
  dba: '',
  tax_id: '',
  default_state: '',
  contact_email: '',
  contact_name: '',
  default_taxability: 'taxable',
  notes: '',
  aliases: '',
}

export default function VendorsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
        if (!active) return
        setWorkspaceId(wsId)
        const list = await api.getVendors(wsId as string)
        if (!active) return
        setVendors(Array.isArray(list) ? list : [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load vendors')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function reload(wsId: string) {
    const list = await api.getVendors(wsId)
    setVendors(Array.isArray(list) ? list : [])
  }

  const states = useMemo(
    () => Array.from(new Set(vendors.map((v) => v.default_state).filter(Boolean) as string[])).sort(),
    [vendors],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter((v) => {
      if (stateFilter && v.default_state !== stateFilter) return false
      if (riskFilter && riskLabel(v.risk_score) !== riskFilter) return false
      if (!q) return true
      const hay = [v.name, v.dba, v.tax_id, v.contact_name, v.contact_email, ...(v.aliases ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [vendors, search, stateFilter, riskFilter])

  const stats = useMemo(() => {
    const total = vendors.length
    const high = vendors.filter((v) => (v.risk_score ?? 0) >= 0.66).length
    const avgRisk = total ? vendors.reduce((s, v) => s + (v.risk_score ?? 0), 0) / total : 0
    return { total, high, avgRisk, statesCount: states.length }
  }, [vendors, states])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    try {
      const aliases = form.aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      const created: Vendor = await api.createVendor({
        workspace_id: workspaceId,
        name: form.name.trim(),
        dba: form.dba.trim() || null,
        tax_id: form.tax_id.trim() || null,
        default_state: form.default_state.trim().toUpperCase() || null,
        contact_email: form.contact_email.trim() || null,
        contact_name: form.contact_name.trim() || null,
        default_taxability: form.default_taxability || null,
        notes: form.notes.trim() || null,
        aliases,
      })
      setVendors((prev) => [created, ...prev])
      setForm(emptyForm)
      setModalOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create vendor')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!workspaceId) return
    if (!confirm('Delete this vendor? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await api.deleteVendor(id)
      setVendors((prev) => prev.filter((v) => v.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete vendor')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading vendors…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900/60 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load vendors</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Vendor Registry</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Suppliers under tax audit, with default taxability profiles and risk scoring.
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setFormError(null); setModalOpen(true) }}>
          + Add Vendor
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Vendors" value={stats.total} tone="teal" />
        <Stat label="High Risk" value={stats.high} tone={stats.high ? 'rose' : 'default'} />
        <Stat label="Avg Risk" value={`${Math.round(stats.avgRisk * 100)}%`} tone="amber" />
        <Stat label="States" value={stats.statesCount} />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, DBA, tax ID, contact…"
            className="min-w-[220px] flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-orange-500 focus:outline-none"
          />
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="">All risk</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="None">None</option>
          </select>
          {(search || stateFilter || riskFilter) && (
            <Button variant="ghost" onClick={() => { setSearch(''); setStateFilter(''); setRiskFilter('') }}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      {vendors.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No vendors yet"
          description="Add your first vendor to start auditing their invoices for tax overcharges."
          action={<Button onClick={() => setModalOpen(true)}>Add Vendor</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="No vendors match your filters." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Vendor</TH>
              <TH>State</TH>
              <TH>Tax ID</TH>
              <TH>Default Taxability</TH>
              <TH>Risk</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((v) => (
              <TR key={v.id}>
                <TD>
                  <Link href={`/dashboard/vendors/${v.id}`} className="font-medium text-orange-300 hover:text-orange-200">
                    {v.name}
                  </Link>
                  {v.dba && <div className="text-xs text-neutral-500">dba {v.dba}</div>}
                  {v.contact_email && <div className="text-xs text-neutral-600">{v.contact_email}</div>}
                </TD>
                <TD>{v.default_state || <span className="text-neutral-600">—</span>}</TD>
                <TD className="font-mono text-xs">{v.tax_id || <span className="text-neutral-600">—</span>}</TD>
                <TD className="capitalize">{v.default_taxability || <span className="text-neutral-600">—</span>}</TD>
                <TD>
                  <Badge tone={riskTone(v.risk_score)}>
                    {riskLabel(v.risk_score)} · {Math.round((v.risk_score ?? 0) * 100)}%
                  </Badge>
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/vendors/${v.id}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    <Button
                      variant="danger"
                      disabled={deletingId === v.id}
                      onClick={() => handleDelete(v.id)}
                    >
                      {deletingId === v.id ? '…' : 'Delete'}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Vendor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="vendor-form" type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : 'Create Vendor'}
            </Button>
          </>
        }
      >
        <form id="vendor-form" onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className={inputCls}
            />
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
              <input
                value={form.default_state}
                onChange={(e) => setForm({ ...form, default_state: e.target.value })}
                placeholder="CA"
                maxLength={2}
                className={inputCls}
              />
            </Field>
            <Field label="Default Taxability">
              <select
                value={form.default_taxability}
                onChange={(e) => setForm({ ...form, default_taxability: e.target.value })}
                className={inputCls}
              >
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
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Aliases" hint="comma separated">
            <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className={inputCls}
            />
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
