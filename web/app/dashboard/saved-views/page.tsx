'use client'

import { useEffect, useMemo, useState } from 'react'
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

interface SavedView {
  id: string
  workspace_id: string
  user_id: string
  name: string
  entity: string
  filters: Record<string, unknown> | null
  is_default: boolean
  created_at: string
}

const ENTITIES = [
  { value: 'findings', label: 'Findings', route: '/dashboard/findings' },
  { value: 'claims', label: 'Claims', route: '/dashboard/claims' },
  { value: 'invoices', label: 'Invoices', route: '/dashboard/invoices' },
  { value: 'vendors', label: 'Vendors', route: '/dashboard/vendors' },
  { value: 'certificates', label: 'Certificates', route: '/dashboard/certificates' },
  { value: 'use-tax', label: 'Use-Tax', route: '/dashboard/use-tax' },
]

function entityMeta(entity: string) {
  return ENTITIES.find((e) => e.value === entity) ?? { value: entity, label: entity, route: '/dashboard' }
}

function entityTone(entity: string): 'teal' | 'green' | 'amber' | 'blue' | 'slate' | 'rose' {
  switch (entity) {
    case 'findings':
      return 'amber'
    case 'claims':
      return 'green'
    case 'invoices':
      return 'blue'
    case 'vendors':
      return 'teal'
    case 'certificates':
      return 'rose'
    default:
      return 'slate'
  }
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none'

const emptyForm = {
  name: '',
  entity: 'findings',
  is_default: false,
  filtersText: '{\n  \n}',
}

export default function SavedViewsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SavedView | null>(null)

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
        const list = await api.getSavedViews({ workspaceId: wsId as string })
        if (!active) return
        setViews(Array.isArray(list) ? list : [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load saved views')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const entities = useMemo(
    () => Array.from(new Set(views.map((v) => v.entity))).sort(),
    [views],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return views.filter((v) => {
      if (entityFilter && v.entity !== entityFilter) return false
      if (!q) return true
      return v.name.toLowerCase().includes(q) || v.entity.toLowerCase().includes(q)
    })
  }, [views, search, entityFilter])

  const stats = useMemo(() => {
    const total = views.length
    const defaults = views.filter((v) => v.is_default).length
    const entityCount = new Set(views.map((v) => v.entity)).size
    return { total, defaults, entityCount }
  }, [views])

  const groups = useMemo(() => {
    const map = new Map<string, SavedView[]>()
    for (const v of filtered) {
      const arr = map.get(v.entity) ?? []
      arr.push(v)
      map.set(v.entity, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    let filters: Record<string, unknown> = {}
    const raw = form.filtersText.trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          filters = parsed as Record<string, unknown>
        } else {
          throw new Error('Filters must be a JSON object')
        }
      } catch (err) {
        setFormError(err instanceof Error ? `Invalid filters JSON: ${err.message}` : 'Invalid filters JSON')
        setSaving(false)
        return
      }
    }
    try {
      const created: SavedView = await api.createSavedView({
        workspace_id: workspaceId,
        name: form.name.trim(),
        entity: form.entity,
        filters,
        is_default: form.is_default,
      })
      setViews((prev) => [created, ...prev])
      setForm(emptyForm)
      setModalOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create saved view')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this saved view? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await api.deleteSavedView(id)
      setViews((prev) => prev.filter((v) => v.id !== id))
      if (detail?.id === id) setDetail(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete saved view')
    } finally {
      setDeletingId(null)
    }
  }

  function filterCount(v: SavedView): number {
    if (!v.filters || typeof v.filters !== 'object') return 0
    return Object.keys(v.filters).length
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading saved views…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900/60 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load saved views</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Saved Views</h1>
          <p className="mt-1 text-sm text-slate-400">
            Reusable filter presets across findings, claims, invoices, and reference data.
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setFormError(null); setModalOpen(true) }}>
          + New View
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Saved Views" value={stats.total} tone="teal" />
        <Stat label="Defaults" value={stats.defaults} tone={stats.defaults ? 'green' : 'default'} />
        <Stat label="Entities Covered" value={stats.entityCount} tone="amber" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or entity…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
          />
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            <option value="">All entities</option>
            {entities.map((en) => (
              <option key={en} value={en}>{entityMeta(en).label}</option>
            ))}
          </select>
          {(search || entityFilter) && (
            <Button variant="ghost" onClick={() => { setSearch(''); setEntityFilter('') }}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      {views.length === 0 ? (
        <EmptyState
          icon="🔖"
          title="No saved views yet"
          description="Save a filter preset for a findings ledger, claim queue, or vendor list so you can jump straight back to it."
          action={<Button onClick={() => setModalOpen(true)}>Create your first view</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="No saved views match your filters." />
      ) : (
        <div className="space-y-6">
          {groups.map(([entity, list]) => (
            <div key={entity} className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge tone={entityTone(entity)}>{entityMeta(entity).label}</Badge>
                <span className="text-xs text-slate-500">{list.length} view{list.length === 1 ? '' : 's'}</span>
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Filters</TH>
                    <TH>Default</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((v) => (
                    <TR key={v.id}>
                      <TD>
                        <button
                          onClick={() => setDetail(v)}
                          className="font-medium text-teal-300 hover:text-teal-200"
                        >
                          {v.name}
                        </button>
                      </TD>
                      <TD>
                        {filterCount(v) > 0 ? (
                          <Badge tone="slate">{filterCount(v)} filter{filterCount(v) === 1 ? '' : 's'}</Badge>
                        ) : (
                          <span className="text-slate-600">no filters</span>
                        )}
                      </TD>
                      <TD>
                        {v.is_default ? (
                          <Badge tone="green">Default</Badge>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TD>
                      <TD className="text-slate-400">
                        {new Date(v.created_at).toLocaleDateString()}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <a href={`${entityMeta(v.entity).route}`}>
                            <Button variant="secondary">Open</Button>
                          </a>
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
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Saved View"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="saved-view-form" type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : 'Create View'}
            </Button>
          </>
        }
      >
        <form id="saved-view-form" onSubmit={handleCreate} className="space-y-4">
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
              placeholder="High-value open findings"
              className={inputCls}
            />
          </Field>
          <Field label="Entity" required>
            <select
              value={form.entity}
              onChange={(e) => setForm({ ...form, entity: e.target.value })}
              className={inputCls}
            >
              {ENTITIES.map((en) => (
                <option key={en.value} value={en.value}>{en.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Filters" hint="JSON object, e.g. {&quot;status&quot;:&quot;open&quot;}">
            <textarea
              value={form.filtersText}
              onChange={(e) => setForm({ ...form, filtersText: e.target.value })}
              rows={5}
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-teal-600 focus:ring-teal-500"
            />
            Set as default view for this entity
          </label>
        </form>
      </Modal>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.name : 'View'}
        footer={
          detail ? (
            <>
              <Button
                variant="danger"
                disabled={deletingId === detail.id}
                onClick={() => handleDelete(detail.id)}
              >
                {deletingId === detail.id ? '…' : 'Delete'}
              </Button>
              <a href={entityMeta(detail.entity).route}>
                <Button>Open {entityMeta(detail.entity).label}</Button>
              </a>
            </>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={entityTone(detail.entity)}>{entityMeta(detail.entity).label}</Badge>
              {detail.is_default && <Badge tone="green">Default</Badge>}
              <span className="text-xs text-slate-500">
                Created {new Date(detail.created_at).toLocaleString()}
              </span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Filters</div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                {JSON.stringify(detail.filters ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

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
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="text-rose-400"> *</span>}
        {hint && <span className="ml-1 text-slate-600">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
