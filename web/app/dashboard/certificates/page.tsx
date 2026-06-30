'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Certificate {
  id: string
  workspace_id: string
  type: string
  state: string
  certificate_number: string | null
  valid_from: string | null
  valid_to: string | null
  status: string
  document_url: string | null
  note: string | null
  created_at: string
}

interface Coverage {
  id: string
  certificate_id: string
  vendor_id: string | null
  category_id: string | null
  created_at: string
}

interface Vendor {
  id: string
  name: string
}

interface Category {
  id: string
  name: string
}

const CERT_TYPES = ['resale', 'exemption', 'direct_pay', 'multi_jurisdiction', 'agricultural', 'manufacturing', 'nonprofit']
const STATUSES = ['active', 'pending', 'expired', 'revoked']

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return Math.ceil((dt.getTime() - Date.now()) / 86400000)
}

function statusTone(status: string): 'green' | 'amber' | 'rose' | 'slate' {
  switch (status) {
    case 'active': return 'green'
    case 'pending': return 'amber'
    case 'expired': return 'rose'
    case 'revoked': return 'rose'
    default: return 'slate'
  }
}

const EMPTY_FORM = {
  type: 'resale',
  state: 'CA',
  certificate_number: '',
  valid_from: '',
  valid_to: '',
  status: 'active',
  document_url: '',
  note: '',
}

export default function CertificatesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [expiring, setExpiring] = useState<Certificate[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [expiryWindow, setExpiryWindow] = useState(60)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Certificate | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [coverageCert, setCoverageCert] = useState<Certificate | null>(null)
  const [coverageRows, setCoverageRows] = useState<Coverage[]>([])
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageVendor, setCoverageVendor] = useState('')
  const [coverageCategory, setCoverageCategory] = useState('')
  const [coverageSaving, setCoverageSaving] = useState(false)

  const vendorName = useCallback((id: string | null) => vendors.find((v) => v.id === id)?.name ?? (id ? 'Unknown vendor' : null), [vendors])
  const categoryName = useCallback((id: string | null) => categories.find((c) => c.id === id)?.name ?? (id ? 'Unknown category' : null), [categories])

  const loadCore = useCallback(async (wsId: string) => {
    const [certs, exp, vens, cats] = await Promise.all([
      api.getCertificates(wsId),
      api.getExpiringCertificates(wsId, expiryWindow),
      api.getVendors(wsId),
      api.getCategories(wsId),
    ])
    setCertificates(Array.isArray(certs) ? certs : [])
    setExpiring(Array.isArray(exp) ? exp : [])
    setVendors(Array.isArray(vens) ? vens : [])
    setCategories(Array.isArray(cats) ? cats : [])
  }, [expiryWindow])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws = await api.getWorkspaces()
        const list: { id: string }[] = Array.isArray(ws) ? ws : []
        if (!list.length) {
          if (active) { setWorkspaceId(null); setLoading(false) }
          return
        }
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('torrd_workspace') : null
        const chosen = list.find((w) => w.id === stored)?.id ?? list[0].id
        if (!active) return
        setWorkspaceId(chosen)
        await loadCore(chosen)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load certificates')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    try {
      await loadCore(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    }
  }, [workspaceId, loadCore])

  // Refresh expiring list when window changes
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      try {
        const exp = await api.getExpiringCertificates(workspaceId, expiryWindow)
        if (active) setExpiring(Array.isArray(exp) ? exp : [])
      } catch {
        /* keep prior list */
      }
    })()
    return () => { active = false }
  }, [expiryWindow, workspaceId])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (c: Certificate) => {
    setEditing(c)
    setForm({
      type: c.type ?? 'resale',
      state: c.state ?? 'CA',
      certificate_number: c.certificate_number ?? '',
      valid_from: c.valid_from ? c.valid_from.slice(0, 10) : '',
      valid_to: c.valid_to ? c.valid_to.slice(0, 10) : '',
      status: c.status ?? 'active',
      document_url: c.document_url ?? '',
      note: c.note ?? '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        workspace_id: workspaceId,
        type: form.type,
        state: form.state,
        certificate_number: form.certificate_number || null,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        status: form.status,
        document_url: form.document_url || null,
        note: form.note || null,
      }
      if (editing) {
        await api.updateCertificate(editing.id, payload)
      } else {
        await api.createCertificate(payload)
      }
      setFormOpen(false)
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Certificate) => {
    if (!confirm(`Delete certificate ${c.certificate_number || c.id}? This cannot be undone.`)) return
    try {
      await api.deleteCertificate(c.id)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const openCoverage = async (c: Certificate) => {
    setCoverageCert(c)
    setCoverageVendor('')
    setCoverageCategory('')
    setCoverageLoading(true)
    try {
      const detail = await api.getCertificate(c.id)
      const cov = (detail && Array.isArray(detail.coverage)) ? detail.coverage : []
      setCoverageRows(cov)
    } catch {
      setCoverageRows([])
    } finally {
      setCoverageLoading(false)
    }
  }

  const addCoverage = async () => {
    if (!coverageCert) return
    if (!coverageVendor && !coverageCategory) {
      alert('Select a vendor and/or category to scope the coverage.')
      return
    }
    setCoverageSaving(true)
    try {
      await api.addCertificateCoverage(coverageCert.id, {
        workspace_id: workspaceId,
        vendor_id: coverageVendor || null,
        category_id: coverageCategory || null,
      })
      const detail = await api.getCertificate(coverageCert.id)
      setCoverageRows(detail && Array.isArray(detail.coverage) ? detail.coverage : [])
      setCoverageVendor('')
      setCoverageCategory('')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add coverage')
    } finally {
      setCoverageSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return certificates.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false
      if (statusFilter && c.status !== statusFilter) return false
      if (stateFilter && c.state !== stateFilter) return false
      if (q) {
        const hay = `${c.certificate_number ?? ''} ${c.type} ${c.state} ${c.note ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [certificates, search, typeFilter, statusFilter, stateFilter])

  const stats = useMemo(() => {
    const active = certificates.filter((c) => c.status === 'active').length
    const expired = certificates.filter((c) => c.status === 'expired').length
    const stateSet = new Set(certificates.map((c) => c.state))
    return { total: certificates.length, active, expired, states: stateSet.size, expiringSoon: expiring.length }
  }, [certificates, expiring])

  const expiryDistribution = useMemo(() => {
    const buckets = { overdue: 0, d0_30: 0, d31_60: 0, d61_90: 0, future: 0, none: 0 }
    for (const c of certificates) {
      const d = daysUntil(c.valid_to)
      if (d === null) buckets.none++
      else if (d < 0) buckets.overdue++
      else if (d <= 30) buckets.d0_30++
      else if (d <= 60) buckets.d31_60++
      else if (d <= 90) buckets.d61_90++
      else buckets.future++
    }
    return buckets
  }, [certificates])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading certificates…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load certificates</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => location.reload()}>Retry</Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon="📄"
          title="No workspace yet"
          description="Create a workspace from Settings before managing exemption certificates."
        />
      </div>
    )
  }

  const maxBucket = Math.max(1, ...Object.values(expiryDistribution))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Exemption Certificates</h1>
          <p className="mt-1 text-sm text-slate-400">
            Registry of resale and exemption certificates, vendor/category coverage, and expiry tracking.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Certificate</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="green" />
        <Stat label="Expired" value={stats.expired} tone="rose" />
        <Stat label="States Covered" value={stats.states} tone="teal" />
        <Stat label={`Expiring ≤${expiryWindow}d`} value={stats.expiringSoon} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Expiry distribution chart */}
        <Card className="p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-white">Expiry Distribution</h2>
          <p className="mt-0.5 text-xs text-slate-500">By days until valid_to</p>
          <div className="mt-4 space-y-3">
            {([
              ['Overdue', expiryDistribution.overdue, 'bg-rose-500'],
              ['0–30 days', expiryDistribution.d0_30, 'bg-amber-500'],
              ['31–60 days', expiryDistribution.d31_60, 'bg-yellow-500'],
              ['61–90 days', expiryDistribution.d61_90, 'bg-teal-500'],
              ['90+ days', expiryDistribution.future, 'bg-emerald-500'],
              ['No expiry', expiryDistribution.none, 'bg-slate-600'],
            ] as const).map(([label, count, color]) => (
              <div key={label}>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{label}</span>
                  <span className="tabular-nums text-slate-300">{count}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${(count / maxBucket) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Expiring soon queue */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Expiring Soon</h2>
              <p className="mt-0.5 text-xs text-slate-500">Certificates approaching their validity window end</p>
            </div>
            <select
              value={expiryWindow}
              onChange={(e) => setExpiryWindow(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
          </div>
          <div className="mt-4">
            {expiring.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
                No certificates expiring within {expiryWindow} days.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {expiring.map((c) => {
                  const d = daysUntil(c.valid_to)
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-200">
                          {c.certificate_number || `${c.type} (${c.state})`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {c.type} · {c.state} · valid to {fmtDate(c.valid_to)}
                        </div>
                      </div>
                      <Badge tone={d !== null && d < 0 ? 'rose' : d !== null && d <= 30 ? 'amber' : 'teal'}>
                        {d === null ? '—' : d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, type, state, note…"
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All types</option>
            {CERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All states</option>
            {Array.from(new Set(certificates.map((c) => c.state))).sort().map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || typeFilter || statusFilter || stateFilter) && (
            <Button variant="ghost" onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); setStateFilter('') }}>Clear</Button>
          )}
        </div>
      </Card>

      {/* Registry table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📄"
          title={certificates.length === 0 ? 'No certificates yet' : 'No matches'}
          description={certificates.length === 0 ? 'Add your first resale or exemption certificate to start tracking coverage and expiry.' : 'Adjust the filters to see more results.'}
          action={certificates.length === 0 ? <Button onClick={openCreate}>+ New Certificate</Button> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Type</TH>
              <TH>State</TH>
              <TH>Status</TH>
              <TH>Valid From</TH>
              <TH>Valid To</TH>
              <TH>Expiry</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((c) => {
              const d = daysUntil(c.valid_to)
              return (
                <TR key={c.id}>
                  <TD className="font-medium text-slate-100">
                    {c.certificate_number || <span className="text-slate-500">—</span>}
                    {c.document_url && (
                      <a href={c.document_url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-teal-400 hover:underline">doc</a>
                    )}
                  </TD>
                  <TD>{c.type}</TD>
                  <TD>{c.state}</TD>
                  <TD><Badge tone={statusTone(c.status)}>{c.status}</Badge></TD>
                  <TD>{fmtDate(c.valid_from)}</TD>
                  <TD>{fmtDate(c.valid_to)}</TD>
                  <TD>
                    {d === null ? <span className="text-slate-500">—</span> : (
                      <span className={d < 0 ? 'text-rose-400' : d <= 30 ? 'text-amber-400' : 'text-slate-400'}>
                        {d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" className="px-2 py-1" onClick={() => openCoverage(c)}>Coverage</Button>
                      <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(c)}>Edit</Button>
                      <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" onClick={() => remove(c)}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Certificate' : 'New Certificate'}
      >
        <form id="cert-form" onSubmit={submitForm} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
                {CERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="State">
              <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={inputCls}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Certificate Number">
            <input value={form.certificate_number} onChange={(e) => setForm({ ...form, certificate_number: e.target.value })} className={inputCls} placeholder="e.g. RS-2024-00123" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valid From">
              <input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Valid To">
              <input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Document URL">
              <input value={form.document_url} onChange={(e) => setForm({ ...form, document_url: e.target.value })} className={inputCls} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Note">
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} rows={2} />
          </Field>
        </form>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setFormOpen(false)} type="button">Cancel</Button>
          <Button type="submit" form="cert-form" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}</Button>
        </div>
      </Modal>

      {/* Coverage modal */}
      <Modal
        open={!!coverageCert}
        onClose={() => setCoverageCert(null)}
        title={coverageCert ? `Coverage · ${coverageCert.certificate_number || coverageCert.type}` : 'Coverage'}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Scope this certificate to specific vendors and/or product categories. Leaving a field blank applies it broadly.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor">
              <select value={coverageVendor} onChange={(e) => setCoverageVendor(e.target.value)} className={inputCls}>
                <option value="">Any vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select value={coverageCategory} onChange={(e) => setCoverageCategory(e.target.value)} className={inputCls}>
                <option value="">Any category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Button onClick={addCoverage} disabled={coverageSaving}>{coverageSaving ? 'Adding…' : '+ Add Coverage'}</Button>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Coverage</h3>
            {coverageLoading ? (
              <div className="py-4"><Spinner /></div>
            ) : coverageRows.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">
                No coverage records yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {coverageRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
                    <Badge tone="teal">{vendorName(row.vendor_id) ?? 'Any vendor'}</Badge>
                    <span className="text-slate-600">×</span>
                    <Badge tone="blue">{categoryName(row.category_id) ?? 'Any category'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
