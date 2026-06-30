'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Vendor {
  id: string
  name: string
  default_state: string | null
}

interface Claim {
  id: string
  workspace_id: string
  vendor_id: string | null
  claim_type: string
  jurisdiction: string | null
  status: string
  expected_cents: number
  recovered_cents: number
  reference_number: string | null
  filed_at: string | null
  recovered_at: string | null
  note: string | null
  created_at: string
}

const STATUSES = ['draft', 'filed', 'in_review', 'approved', 'partial', 'recovered', 'denied']
const CLAIM_TYPES = ['vendor_refund', 'state_refund', 'credit_memo', 'amended_return']

function money(cents: number): string {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function statusTone(status: string): 'teal' | 'green' | 'amber' | 'rose' | 'blue' | 'slate' {
  switch (status) {
    case 'recovered':
    case 'approved':
      return 'green'
    case 'filed':
    case 'in_review':
      return 'blue'
    case 'partial':
      return 'amber'
    case 'denied':
      return 'rose'
    case 'draft':
      return 'slate'
    default:
      return 'teal'
  }
}

export default function ClaimsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [claims, setClaims] = useState<Claim[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    vendor_id: '',
    claim_type: 'vendor_refund',
    jurisdiction: '',
    expected_cents: '',
    reference_number: '',
    note: '',
  })

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws = await api.getWorkspaces()
        if (!active) return
        const id = Array.isArray(ws) && ws.length > 0 ? ws[0].id : null
        setWorkspaceId(id)
        if (!id) setLoading(false)
      } catch (e) {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function load(id: string) {
    setLoading(true)
    setError(null)
    try {
      const [c, v] = await Promise.all([api.getClaims(id), api.getVendors(id)])
      setClaims(Array.isArray(c) ? c : [])
      setVendors(Array.isArray(v) ? v : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId])

  const vendorName = (id: string | null) =>
    id ? vendors.find((v) => v.id === id)?.name ?? 'Unknown vendor' : 'Direct / state'

  const filtered = useMemo(() => {
    return claims.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${c.reference_number || ''} ${c.jurisdiction || ''} ${c.claim_type} ${vendorName(c.vendor_id)} ${c.note || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims, statusFilter, search, vendors])

  const totals = useMemo(() => {
    const expected = claims.reduce((s, c) => s + (c.expected_cents || 0), 0)
    const recovered = claims.reduce((s, c) => s + (c.recovered_cents || 0), 0)
    const open = claims.filter((c) => !['recovered', 'denied'].includes(c.status)).length
    const rate = expected > 0 ? Math.round((recovered / expected) * 100) : 0
    return { expected, recovered, open, rate }
  }, [claims])

  function openCreate() {
    setForm({
      vendor_id: '',
      claim_type: 'vendor_refund',
      jurisdiction: '',
      expected_cents: '',
      reference_number: '',
      note: '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function createClaim() {
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    try {
      const dollars = parseFloat(form.expected_cents || '0')
      await api.createClaim({
        workspace_id: workspaceId,
        vendor_id: form.vendor_id || null,
        claim_type: form.claim_type,
        jurisdiction: form.jurisdiction || null,
        status: 'draft',
        expected_cents: Math.round((isNaN(dollars) ? 0 : dollars) * 100),
        reference_number: form.reference_number || null,
        note: form.note || null,
      })
      setModalOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create claim')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading claims…" />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before filing refund claims."
          icon={<span>📂</span>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Refund Claims</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track vendor and state refund claims from draft through recovery.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Claim</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Claims" value={claims.length} tone="teal" />
        <Stat label="Open Claims" value={totals.open} tone="amber" />
        <Stat label="Expected Value" value={money(totals.expected)} />
        <Stat
          label="Recovered"
          value={money(totals.recovered)}
          tone="green"
          sub={`${totals.rate}% recovery rate`}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, vendor, jurisdiction…"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === '' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={claims.length === 0 ? 'No claims yet' : 'No claims match your filters'}
          description={
            claims.length === 0
              ? 'Create a refund claim to start tracking your recovery pipeline.'
              : 'Try clearing the search or status filter.'
          }
          action={claims.length === 0 ? <Button onClick={openCreate}>+ New Claim</Button> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Vendor</TH>
              <TH>Type</TH>
              <TH>Jurisdiction</TH>
              <TH>Status</TH>
              <TH className="text-right">Expected</TH>
              <TH className="text-right">Recovered</TH>
              <TH>Filed</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium text-white">{c.reference_number || c.id.slice(0, 8)}</TD>
                <TD className="text-slate-300">{vendorName(c.vendor_id)}</TD>
                <TD className="capitalize text-slate-400">{c.claim_type.replace(/_/g, ' ')}</TD>
                <TD className="text-slate-400">{c.jurisdiction || '—'}</TD>
                <TD>
                  <Badge tone={statusTone(c.status)} className="capitalize">
                    {c.status.replace(/_/g, ' ')}
                  </Badge>
                </TD>
                <TD className="text-right tabular-nums text-slate-300">{money(c.expected_cents)}</TD>
                <TD className="text-right tabular-nums font-medium text-teal-300">
                  {money(c.recovered_cents)}
                </TD>
                <TD className="text-slate-400">
                  {c.filed_at ? new Date(c.filed_at).toLocaleDateString('en-US') : '—'}
                </TD>
                <TD className="text-right">
                  <Link
                    href={`/dashboard/claims/${c.id}`}
                    className="text-sm font-medium text-teal-400 hover:text-teal-300"
                  >
                    Open →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Refund Claim"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={createClaim} disabled={saving}>
              {saving ? 'Creating…' : 'Create Claim'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Vendor
            </label>
            <select
              value={form.vendor_id}
              onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
            >
              <option value="">No vendor (state / direct)</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Claim Type
              </label>
              <select
                value={form.claim_type}
                onChange={(e) => setForm({ ...form, claim_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm capitalize text-white focus:border-teal-500 focus:outline-none"
              >
                {CLAIM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Jurisdiction
              </label>
              <input
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
                placeholder="e.g. CA, TX-Harris"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Expected Amount (USD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.expected_cents}
                onChange={(e) => setForm({ ...form, expected_cents: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Reference #
              </label>
              <input
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                placeholder="Optional"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Note
            </label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={3}
              placeholder="Optional context for this claim…"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-500">
            Attach findings to this claim from the detail page after it is created.
          </p>
        </div>
      </Modal>
    </div>
  )
}
