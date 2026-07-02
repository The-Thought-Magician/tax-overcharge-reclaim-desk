'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface StatuteRule {
  id: string
  workspace_id: string
  state: string
  window_months: number
  basis: string | null
  note: string | null
  created_at: string
}

interface Finding {
  id: string
  type: string
  jurisdiction: string | null
  recoverable_cents: number
  reason: string | null
  status: string
  transaction_date: string | null
  statute_deadline: string | null
  vendor_id: string | null
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const ms = d.getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function urgencyTone(days: number | null): 'rose' | 'amber' | 'teal' | 'slate' {
  if (days === null) return 'slate'
  if (days <= 14) return 'rose'
  if (days <= 45) return 'amber'
  return 'teal'
}

export default function StatutePage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [rules, setRules] = useState<StatuteRule[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(90)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StatuteRule | null>(null)
  const [form, setForm] = useState({ state: '', window_months: 36, basis: 'transaction_date', note: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws = await api.getWorkspaces()
        if (!active) return
        const id = Array.isArray(ws) && ws.length > 0 ? ws[0].id : null
        setWorkspaceId(id)
        if (!id) {
          setLoading(false)
          return
        }
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

  async function load(id: string, days: number) {
    setLoading(true)
    setError(null)
    try {
      const [r, f] = await Promise.all([api.getStatuteRules(id), api.getExpiringFindings(id, days)])
      setRules(Array.isArray(r) ? r : [])
      setFindings(Array.isArray(f) ? f : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load statute data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (workspaceId) load(workspaceId, windowDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, windowDays])

  const sortedFindings = useMemo(() => {
    return [...findings].sort((a, b) => {
      const da = daysUntil(a.statute_deadline)
      const db = daysUntil(b.statute_deadline)
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    })
  }, [findings])

  const atRiskCents = useMemo(
    () => sortedFindings.reduce((s, f) => s + (f.recoverable_cents || 0), 0),
    [sortedFindings],
  )

  const critical = useMemo(
    () => sortedFindings.filter((f) => {
      const d = daysUntil(f.statute_deadline)
      return d !== null && d <= 14
    }),
    [sortedFindings],
  )

  // Group findings by deadline month for a simple calendar/timeline view
  const byMonth = useMemo(() => {
    const map = new Map<string, { label: string; count: number; cents: number; minDays: number }>()
    for (const f of sortedFindings) {
      if (!f.statute_deadline) continue
      const d = new Date(f.statute_deadline)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      const days = daysUntil(f.statute_deadline) ?? 9999
      const cur = map.get(key)
      if (cur) {
        cur.count += 1
        cur.cents += f.recoverable_cents || 0
        cur.minDays = Math.min(cur.minDays, days)
      } else {
        map.set(key, { label, count: 1, cents: f.recoverable_cents || 0, minDays: days })
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({ key, ...v }))
  }, [sortedFindings])

  const maxMonthCents = useMemo(() => Math.max(1, ...byMonth.map((m) => m.cents)), [byMonth])

  function openCreate() {
    setEditing(null)
    setForm({ state: '', window_months: 36, basis: 'transaction_date', note: '' })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(rule: StatuteRule) {
    setEditing(rule)
    setForm({
      state: rule.state,
      window_months: rule.window_months,
      basis: rule.basis || 'transaction_date',
      note: rule.note || '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function saveRule() {
    if (!workspaceId) return
    if (!form.state) {
      setFormError('State is required')
      return
    }
    if (!form.window_months || form.window_months < 1) {
      setFormError('Window months must be at least 1')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.upsertStatuteRule({
        workspace_id: workspaceId,
        state: form.state,
        window_months: Number(form.window_months),
        basis: form.basis || null,
        note: form.note || null,
      })
      setModalOpen(false)
      await load(workspaceId, windowDays)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading statute clock…" />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before configuring statute-of-limitations rules."
          icon={<span>🏛️</span>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Statute Clock</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Statute-of-limitations rules per state and the refund findings approaching their filing deadline.
          </p>
        </div>
        <Button onClick={openCreate}>+ Add SOL Rule</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Configured States" value={rules.length} tone="teal" />
        <Stat label="Expiring Findings" value={sortedFindings.length} tone="amber" />
        <Stat label="At-Risk Value" value={money(atRiskCents)} tone="rose" />
        <Stat label="Critical (≤14 days)" value={critical.length} tone="rose" sub="Immediate action" />
      </div>

      {/* Deadline timeline / calendar */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Deadline Calendar
          </h2>
          <span className="text-xs text-neutral-500">Recoverable value by deadline month</span>
        </div>
        {byMonth.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">No upcoming statute deadlines in the window.</p>
        ) : (
          <div className="space-y-3">
            {byMonth.map((m) => {
              const tone = urgencyTone(m.minDays)
              const barColor =
                tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-orange-500'
              return (
                <div key={m.key} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-sm font-medium text-neutral-300">{m.label}</div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded bg-neutral-800">
                    <div
                      className={`h-full ${barColor} transition-all`}
                      style={{ width: `${Math.max(6, (m.cents / maxMonthCents) * 100)}%` }}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium text-white">
                      {money(m.cents)} · {m.count} finding{m.count === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* SOL rules */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Statute-of-Limitations Rules
        </h2>
        {rules.length === 0 ? (
          <EmptyState
            title="No SOL rules configured"
            description="Add a rule to define the refund-claim filing window for each state where you have nexus."
            action={<Button onClick={openCreate}>+ Add SOL Rule</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>State</TH>
                <TH>Window</TH>
                <TH>Basis</TH>
                <TH>Note</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Badge tone="teal">{r.state}</Badge>
                  </TD>
                  <TD className="tabular-nums">{r.window_months} months</TD>
                  <TD className="text-neutral-400">{r.basis || '—'}</TD>
                  <TD className="max-w-xs truncate text-neutral-400">{r.note || '—'}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" onClick={() => openEdit(r)}>
                      Edit
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      {/* Expiring queue */}
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Expiring Findings Queue
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Window:</span>
            {[30, 60, 90, 180].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  windowDays === d
                    ? 'bg-orange-600 text-white'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {sortedFindings.length === 0 ? (
          <EmptyState
            title="No findings expiring soon"
            description={`No refund findings fall within ${windowDays} days of their statute deadline.`}
            icon={<span>✅</span>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deadline</TH>
                <TH>Days Left</TH>
                <TH>Type</TH>
                <TH>Jurisdiction</TH>
                <TH className="text-right">Recoverable</TH>
                <TH>Status</TH>
                <TH>Reason</TH>
              </TR>
            </THead>
            <TBody>
              {sortedFindings.map((f) => {
                const d = daysUntil(f.statute_deadline)
                const tone = urgencyTone(d)
                return (
                  <TR key={f.id}>
                    <TD className="tabular-nums">
                      {f.statute_deadline
                        ? new Date(f.statute_deadline).toLocaleDateString('en-US')
                        : '—'}
                    </TD>
                    <TD>
                      <Badge tone={tone}>{d === null ? '—' : `${d}d`}</Badge>
                    </TD>
                    <TD className="capitalize">{f.type.replace(/_/g, ' ')}</TD>
                    <TD className="text-neutral-400">{f.jurisdiction || '—'}</TD>
                    <TD className="text-right font-medium tabular-nums text-orange-300">
                      {money(f.recoverable_cents || 0)}
                    </TD>
                    <TD className="capitalize text-neutral-400">{f.status}</TD>
                    <TD className="max-w-xs truncate text-neutral-400">{f.reason || '—'}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit SOL Rule — ${editing.state}` : 'Add SOL Rule'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveRule} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Rule' : 'Create Rule'}
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              State
            </label>
            <select
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              disabled={!!editing}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select state…</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {editing && (
              <p className="mt-1 text-xs text-neutral-500">State cannot be changed; this upserts the existing rule.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Filing Window (months)
            </label>
            <input
              type="number"
              min={1}
              value={form.window_months}
              onChange={(e) => setForm({ ...form, window_months: Number(e.target.value) })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Basis
            </label>
            <select
              value={form.basis}
              onChange={(e) => setForm({ ...form, basis: e.target.value })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            >
              <option value="transaction_date">Transaction date</option>
              <option value="invoice_date">Invoice date</option>
              <option value="payment_date">Payment date</option>
              <option value="filing_date">Filing date</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Note
            </label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={3}
              placeholder="Optional citation or special handling notes…"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
