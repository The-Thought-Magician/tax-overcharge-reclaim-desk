'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  updated_at: string
}

interface Finding {
  id: string
  type: string
  jurisdiction: string | null
  recoverable_cents: number
  reason: string | null
  status: string
  statute_deadline: string | null
  vendor_id: string | null
}

interface Activity {
  id: string
  claim_id: string
  action: string
  detail: string | null
  user_id: string | null
  created_at: string
}

const STATUSES = ['draft', 'filed', 'in_review', 'approved', 'partial', 'recovered', 'denied']

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

function when(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US')
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>()
  const claimId = params.id
  const router = useRouter()

  const [claim, setClaim] = useState<Claim | null>(null)
  const [attached, setAttached] = useState<Finding[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [allFindings, setAllFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // edit form
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    status: 'draft',
    recovered_cents: '',
    expected_cents: '',
    reference_number: '',
    jurisdiction: '',
    note: '',
  })
  const [savingEdit, setSavingEdit] = useState(false)

  // attach findings
  const [attachOpen, setAttachOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [attachSearch, setAttachSearch] = useState('')
  const [attaching, setAttaching] = useState(false)

  // activity note
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getClaim(claimId)
      const c: Claim = res.claim ?? res
      setClaim(c)
      const f: Finding[] = Array.isArray(res.findings) ? res.findings : []
      setAttached(f)
      const act: Activity[] = Array.isArray(res.activity) ? res.activity : []
      // also fetch activity explicitly to ensure freshness
      let activityList = act
      try {
        const a = await api.getClaimActivity(claimId)
        if (Array.isArray(a)) activityList = a
      } catch {
        /* fall back to embedded activity */
      }
      setActivity(activityList)
      // load candidate findings for attach modal
      if (c?.workspace_id) {
        try {
          const all = await api.getFindings({ workspaceId: c.workspace_id })
          setAllFindings(Array.isArray(all) ? all : [])
        } catch {
          setAllFindings([])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claim')
    } finally {
      setLoading(false)
    }
  }, [claimId])

  useEffect(() => {
    load()
  }, [load])

  const attachedIds = useMemo(() => new Set(attached.map((f) => f.id)), [attached])

  const candidates = useMemo(() => {
    return allFindings.filter((f) => {
      if (attachedIds.has(f.id)) return false
      if (attachSearch) {
        const q = attachSearch.toLowerCase()
        const hay = `${f.type} ${f.jurisdiction || ''} ${f.reason || ''} ${f.status}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allFindings, attachedIds, attachSearch])

  const attachedTotal = useMemo(
    () => attached.reduce((s, f) => s + (f.recoverable_cents || 0), 0),
    [attached],
  )

  function openEdit() {
    if (!claim) return
    setEditForm({
      status: claim.status,
      recovered_cents: claim.recovered_cents ? String(claim.recovered_cents / 100) : '',
      expected_cents: claim.expected_cents ? String(claim.expected_cents / 100) : '',
      reference_number: claim.reference_number || '',
      jurisdiction: claim.jurisdiction || '',
      note: claim.note || '',
    })
    setActionError(null)
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!claim) return
    setSavingEdit(true)
    setActionError(null)
    try {
      const recovered = parseFloat(editForm.recovered_cents || '0')
      const expected = parseFloat(editForm.expected_cents || '0')
      await api.updateClaim(claim.id, {
        status: editForm.status,
        recovered_cents: Math.round((isNaN(recovered) ? 0 : recovered) * 100),
        expected_cents: Math.round((isNaN(expected) ? 0 : expected) * 100),
        reference_number: editForm.reference_number || null,
        jurisdiction: editForm.jurisdiction || null,
        note: editForm.note || null,
      })
      // log the status change as activity
      try {
        await api.addClaimActivity({
          claim_id: claim.id,
          action: 'updated',
          detail: `Status set to ${editForm.status}; recovered ${money(Math.round((isNaN(recovered) ? 0 : recovered) * 100))}`,
        })
      } catch {
        /* non-fatal */
      }
      setEditOpen(false)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update claim')
    } finally {
      setSavingEdit(false)
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function attachSelected() {
    if (!claim || selectedIds.size === 0) return
    setAttaching(true)
    setActionError(null)
    try {
      await api.attachFindingsToClaim(claim.id, { finding_ids: Array.from(selectedIds) })
      try {
        await api.addClaimActivity({
          claim_id: claim.id,
          action: 'findings_attached',
          detail: `Attached ${selectedIds.size} finding${selectedIds.size === 1 ? '' : 's'}`,
        })
      } catch {
        /* non-fatal */
      }
      setSelectedIds(new Set())
      setAttachOpen(false)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to attach findings')
    } finally {
      setAttaching(false)
    }
  }

  async function addNote() {
    if (!claim || !noteText.trim()) return
    setAddingNote(true)
    setActionError(null)
    try {
      await api.addClaimActivity({ claim_id: claim.id, action: 'note', detail: noteText.trim() })
      setNoteText('')
      const a = await api.getClaimActivity(claim.id)
      setActivity(Array.isArray(a) ? a : [])
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading claim…" />
      </div>
    )
  }

  if (error || !claim) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="Claim not found"
          description={error || 'This claim could not be loaded.'}
          icon={<span>⚠️</span>}
          action={
            <Button variant="secondary" onClick={() => router.push('/dashboard/claims')}>
              Back to Claims
            </Button>
          }
        />
      </div>
    )
  }

  const sortedActivity = [...activity].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard/claims" className="text-sm text-neutral-400 hover:text-orange-300">
          ← Back to Claims
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">
              {claim.reference_number || `Claim ${claim.id.slice(0, 8)}`}
            </h1>
            <Badge tone={statusTone(claim.status)} className="capitalize">
              {claim.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm capitalize text-neutral-400">
            {claim.claim_type.replace(/_/g, ' ')}
            {claim.jurisdiction ? ` · ${claim.jurisdiction}` : ''} · created {when(claim.created_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAttachOpen(true)}>
            Attach Findings
          </Button>
          <Button onClick={openEdit}>Edit Claim</Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Expected" value={money(claim.expected_cents)} />
        <Stat label="Recovered" value={money(claim.recovered_cents)} tone="green" />
        <Stat label="Attached Findings" value={attached.length} tone="teal" sub={money(attachedTotal)} />
        <Stat
          label="Filed"
          value={claim.filed_at ? new Date(claim.filed_at).toLocaleDateString('en-US') : 'Not filed'}
          sub={claim.recovered_at ? `Recovered ${new Date(claim.recovered_at).toLocaleDateString('en-US')}` : undefined}
        />
      </div>

      {claim.note && (
        <Card className="p-5">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Note</div>
          <p className="whitespace-pre-wrap text-sm text-neutral-300">{claim.note}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Attached findings */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Attached Findings
            </h2>
            <Button variant="ghost" onClick={() => setAttachOpen(true)}>
              + Attach
            </Button>
          </div>
          {attached.length === 0 ? (
            <EmptyState
              title="No findings attached"
              description="Attach overcharge findings to substantiate this refund claim."
              action={<Button onClick={() => setAttachOpen(true)}>Attach Findings</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Jurisdiction</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH>Deadline</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {attached.map((f) => (
                  <TR key={f.id}>
                    <TD className="capitalize text-neutral-200">{f.type.replace(/_/g, ' ')}</TD>
                    <TD className="text-neutral-400">{f.jurisdiction || '—'}</TD>
                    <TD className="text-right tabular-nums font-medium text-orange-300">
                      {money(f.recoverable_cents || 0)}
                    </TD>
                    <TD className="text-neutral-400">
                      {f.statute_deadline
                        ? new Date(f.statute_deadline).toLocaleDateString('en-US')
                        : '—'}
                    </TD>
                    <TD className="capitalize text-neutral-400">{f.status}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* Activity */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Activity</h2>
          <Card className="p-4">
            <div className="mb-4 flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addNote()
                }}
                placeholder="Add a note…"
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
              />
              <Button onClick={addNote} disabled={addingNote || !noteText.trim()}>
                {addingNote ? '…' : 'Add'}
              </Button>
            </div>
            {sortedActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">No activity recorded yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-neutral-800 pl-4">
                {sortedActivity.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[1.30rem] top-1.5 h-2 w-2 rounded-full bg-orange-500" />
                    <div className="flex items-center gap-2">
                      <Badge tone="slate" className="capitalize">
                        {a.action.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-xs text-neutral-500">{when(a.created_at)}</span>
                    </div>
                    {a.detail && <p className="mt-1 text-sm text-neutral-300">{a.detail}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Claim"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Status
              </label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm capitalize text-white focus:border-orange-500 focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Jurisdiction
              </label>
              <input
                value={editForm.jurisdiction}
                onChange={(e) => setEditForm({ ...editForm, jurisdiction: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Expected (USD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editForm.expected_cents}
                onChange={(e) => setEditForm({ ...editForm, expected_cents: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Recovered (USD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editForm.recovered_cents}
                onChange={(e) => setEditForm({ ...editForm, recovered_cents: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Reference #
            </label>
            <input
              value={editForm.reference_number}
              onChange={(e) => setEditForm({ ...editForm, reference_number: e.target.value })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Note
            </label>
            <textarea
              value={editForm.note}
              onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Attach findings modal */}
      <Modal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Attach Findings"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAttachOpen(false)} disabled={attaching}>
              Cancel
            </Button>
            <Button onClick={attachSelected} disabled={attaching || selectedIds.size === 0}>
              {attaching ? 'Attaching…' : `Attach ${selectedIds.size || ''}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            value={attachSearch}
            onChange={(e) => setAttachSearch(e.target.value)}
            placeholder="Search findings by type, jurisdiction, reason…"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
          />
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              {allFindings.length === 0
                ? 'No findings available in this workspace.'
                : 'No unattached findings match your search.'}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {candidates.map((f) => {
                const checked = selectedIds.has(f.id)
                return (
                  <label
                    key={f.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                      checked
                        ? 'border-orange-600 bg-orange-950/40'
                        : 'border-neutral-700 bg-neutral-800/50 hover:bg-neutral-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(f.id)}
                      className="h-4 w-4 accent-orange-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize text-neutral-200">
                          {f.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-neutral-500">{f.jurisdiction || '—'}</span>
                      </div>
                      {f.reason && <p className="truncate text-xs text-neutral-500">{f.reason}</p>}
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-orange-300">
                      {money(f.recoverable_cents || 0)}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
