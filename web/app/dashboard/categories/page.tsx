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

interface Category {
  id: string
  workspace_id: string
  name: string
  code: string | null
  description: string | null
  created_at: string
}

interface TaxabilityRule {
  id: string
  workspace_id: string
  category_id: string
  state: string
  taxability: string
  reduced_rate: number | null
  note: string | null
  created_at: string
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']
const TAXABILITY = ['taxable', 'exempt', 'reduced', 'zero_rated']

// Matrix columns: a focused set of common nexus states. The full editor still supports any state.
const MATRIX_STATES = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'WA', 'GA', 'NC', 'NJ', 'CO']

function taxTone(t: string): 'green' | 'amber' | 'rose' | 'blue' | 'slate' {
  switch (t) {
    case 'taxable': return 'rose'
    case 'exempt': return 'green'
    case 'reduced': return 'amber'
    case 'zero_rated': return 'blue'
    default: return 'slate'
  }
}

function taxShort(t: string): string {
  switch (t) {
    case 'taxable': return 'T'
    case 'exempt': return 'E'
    case 'reduced': return 'R'
    case 'zero_rated': return 'Z'
    default: return '?'
  }
}

const EMPTY_CAT = { name: '', code: '', description: '' }
const EMPTY_RULE = { category_id: '', state: 'CA', taxability: 'taxable', reduced_rate: '', note: '' }

export default function CategoriesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<TaxabilityRule[]>([])

  const [search, setSearch] = useState('')
  const [view, setView] = useState<'matrix' | 'list'>('matrix')

  // category modal
  const [catOpen, setCatOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState(EMPTY_CAT)
  const [catSaving, setCatSaving] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)

  // rule modal
  const [ruleOpen, setRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<TaxabilityRule | null>(null)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleError, setRuleError] = useState<string | null>(null)

  const loadAll = useCallback(async (wsId: string) => {
    const [cats, rls] = await Promise.all([
      api.getCategories(wsId),
      api.getTaxabilityRules({ workspaceId: wsId }),
    ])
    setCategories(Array.isArray(cats) ? cats : [])
    setRules(Array.isArray(rls) ? rls : [])
  }, [])

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
        await loadAll(chosen)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load categories')
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
      await loadAll(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    }
  }, [workspaceId, loadAll])

  // index rules by category+state
  const ruleIndex = useMemo(() => {
    const m = new Map<string, TaxabilityRule>()
    for (const r of rules) m.set(`${r.category_id}:${r.state}`, r)
    return m
  }, [rules])

  const rulesByCategory = useMemo(() => {
    const m = new Map<string, TaxabilityRule[]>()
    for (const r of rules) {
      const arr = m.get(r.category_id) ?? []
      arr.push(r)
      m.set(r.category_id, arr)
    }
    return m
  }, [rules])

  // Category CRUD
  const openCreateCat = () => { setEditingCat(null); setCatForm(EMPTY_CAT); setCatError(null); setCatOpen(true) }
  const openEditCat = (c: Category) => {
    setEditingCat(c)
    setCatForm({ name: c.name, code: c.code ?? '', description: c.description ?? '' })
    setCatError(null)
    setCatOpen(true)
  }
  const submitCat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setCatSaving(true)
    setCatError(null)
    try {
      const payload = { workspace_id: workspaceId, name: catForm.name, code: catForm.code || null, description: catForm.description || null }
      if (editingCat) await api.updateCategory(editingCat.id, payload)
      else await api.createCategory(payload)
      setCatOpen(false)
      await refresh()
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCatSaving(false)
    }
  }
  const removeCat = async (c: Category) => {
    if (!confirm(`Delete category "${c.name}" and its taxability rules?`)) return
    try {
      await api.deleteCategory(c.id)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  // Rule CRUD
  const openCreateRule = (categoryId?: string, state?: string) => {
    setEditingRule(null)
    setRuleForm({ ...EMPTY_RULE, category_id: categoryId ?? (categories[0]?.id ?? ''), state: state ?? 'CA' })
    setRuleError(null)
    setRuleOpen(true)
  }
  const openEditRule = (r: TaxabilityRule) => {
    setEditingRule(r)
    setRuleForm({
      category_id: r.category_id,
      state: r.state,
      taxability: r.taxability,
      reduced_rate: r.reduced_rate != null ? String(r.reduced_rate) : '',
      note: r.note ?? '',
    })
    setRuleError(null)
    setRuleOpen(true)
  }
  // open rule editor pre-filled from a matrix cell (existing rule -> edit, else create)
  const openCell = (categoryId: string, state: string) => {
    const existing = ruleIndex.get(`${categoryId}:${state}`)
    if (existing) openEditRule(existing)
    else openCreateRule(categoryId, state)
  }
  const submitRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || !ruleForm.category_id) { setRuleError('Pick a category'); return }
    setRuleSaving(true)
    setRuleError(null)
    try {
      const rr = ruleForm.taxability === 'reduced' && ruleForm.reduced_rate.trim() !== '' ? parseFloat(ruleForm.reduced_rate) : null
      const payload = {
        workspace_id: workspaceId,
        category_id: ruleForm.category_id,
        state: ruleForm.state,
        taxability: ruleForm.taxability,
        reduced_rate: rr,
        note: ruleForm.note || null,
      }
      if (editingRule) await api.updateTaxabilityRule(editingRule.id, payload)
      else await api.createTaxabilityRule(payload)
      setRuleOpen(false)
      await refresh()
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setRuleSaving(false)
    }
  }
  const removeRule = async (r: TaxabilityRule) => {
    if (!confirm(`Delete the ${r.state} rule for this category?`)) return
    try {
      await api.deleteTaxabilityRule(r.id)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const filteredCats = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return categories
    return categories.filter((c) => `${c.name} ${c.code ?? ''} ${c.description ?? ''}`.toLowerCase().includes(q))
  }, [categories, search])

  const stats = useMemo(() => {
    const ruleStates = new Set(rules.map((r) => r.state)).size
    const taxableRules = rules.filter((r) => r.taxability === 'taxable').length
    const exemptRules = rules.filter((r) => r.taxability === 'exempt').length
    return { categories: categories.length, rules: rules.length, ruleStates, taxableRules, exemptRules }
  }, [categories, rules])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner label="Loading categories…" /></div>
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load categories</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <div className="mt-4"><Button variant="secondary" onClick={() => location.reload()}>Retry</Button></div>
        </Card>
      </div>
    )
  }

  if (!workspaceId) {
    return <div className="mx-auto max-w-xl"><EmptyState icon="🏷️" title="No workspace yet" description="Create a workspace from Settings before managing product categories." /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Product Categories &amp; Taxability</h1>
          <p className="mt-1 text-sm text-slate-400">Catalog of product/service categories and their per-state taxability treatment.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openCreateRule()} disabled={categories.length === 0}>+ Taxability Rule</Button>
          <Button onClick={openCreateCat}>+ New Category</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Categories" value={stats.categories} />
        <Stat label="Taxability Rules" value={stats.rules} tone="teal" />
        <Stat label="States Mapped" value={stats.ruleStates} />
        <Stat label="Taxable Rules" value={stats.taxableRules} tone="rose" />
        <Stat label="Exempt Rules" value={stats.exemptRules} tone="green" />
      </div>

      {/* controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories…" className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
            <button onClick={() => setView('matrix')} className={`px-3 py-2 text-sm ${view === 'matrix' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>Matrix</button>
            <button onClick={() => setView('list')} className={`px-3 py-2 text-sm ${view === 'list' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>List</button>
          </div>
        </div>
      </Card>

      {categories.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No categories yet"
          description="Create product categories, then map their taxability per state."
          action={<Button onClick={openCreateCat}>+ New Category</Button>}
        />
      ) : view === 'matrix' ? (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Taxability Matrix</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Legend tone="rose" label="Taxable" />
              <Legend tone="green" label="Exempt" />
              <Legend tone="amber" label="Reduced" />
              <Legend tone="blue" label="Zero-rated" />
              <span className="text-slate-600">· click a cell to set</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-900/80 px-4 py-3 font-medium">Category</th>
                  {MATRIX_STATES.map((s) => <th key={s} className="px-2 py-3 text-center font-medium">{s}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredCats.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-900/40">
                    <td className="sticky left-0 z-10 bg-slate-950/90 px-4 py-2">
                      <div className="font-medium text-slate-100">{c.name}</div>
                      {c.code && <div className="text-xs text-slate-500">{c.code}</div>}
                    </td>
                    {MATRIX_STATES.map((s) => {
                      const r = ruleIndex.get(`${c.id}:${s}`)
                      return (
                        <td key={s} className="px-2 py-2 text-center">
                          <button
                            onClick={() => openCell(c.id, s)}
                            title={r ? `${r.taxability}${r.reduced_rate != null ? ` @ ${r.reduced_rate}` : ''}` : 'Set rule'}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-colors ${
                              r
                                ? r.taxability === 'taxable' ? 'bg-rose-950 text-rose-300 hover:bg-rose-900 border border-rose-800'
                                : r.taxability === 'exempt' ? 'bg-emerald-950 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                                : r.taxability === 'reduced' ? 'bg-amber-950 text-amber-300 hover:bg-amber-900 border border-amber-800'
                                : 'bg-sky-950 text-sky-300 hover:bg-sky-900 border border-sky-800'
                                : 'border border-dashed border-slate-700 text-slate-600 hover:border-teal-600 hover:text-teal-400'
                            }`}
                          >
                            {r ? taxShort(r.taxability) : '+'}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-800 px-4 py-2 text-xs text-slate-600">
            Matrix shows {MATRIX_STATES.length} common nexus states. Use the List view to manage rules for any state.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCats.map((c) => {
            const catRules = (rulesByCategory.get(c.id) ?? []).slice().sort((a, b) => a.state.localeCompare(b.state))
            return (
              <Card key={c.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{c.name}</h3>
                      {c.code && <Badge tone="slate">{c.code}</Badge>}
                    </div>
                    {c.description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{c.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" className="px-2 py-1" onClick={() => openCreateRule(c.id)}>+ Rule</Button>
                    <Button variant="ghost" className="px-2 py-1" onClick={() => openEditCat(c)}>Edit</Button>
                    <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" onClick={() => removeCat(c)}>Delete</Button>
                  </div>
                </div>
                <div className="mt-4">
                  {catRules.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-sm text-slate-500">No taxability rules. Defaults to fully taxable until configured.</p>
                  ) : (
                    <Table>
                      <THead>
                        <TR><TH>State</TH><TH>Taxability</TH><TH>Reduced Rate</TH><TH>Note</TH><TH className="text-right">Actions</TH></TR>
                      </THead>
                      <TBody>
                        {catRules.map((r) => (
                          <TR key={r.id}>
                            <TD className="font-medium text-slate-100">{r.state}</TD>
                            <TD><Badge tone={taxTone(r.taxability)}>{r.taxability}</Badge></TD>
                            <TD>{r.reduced_rate != null ? (r.reduced_rate <= 1 ? `${(r.reduced_rate * 100).toFixed(3)}%` : `${r.reduced_rate}`) : '—'}</TD>
                            <TD className="text-slate-400">{r.note || '—'}</TD>
                            <TD className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" className="px-2 py-1" onClick={() => openEditRule(r)}>Edit</Button>
                                <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" onClick={() => removeRule(r)}>Delete</Button>
                              </div>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>
              </Card>
            )
          })}
          {filteredCats.length === 0 && (
            <EmptyState icon="🔍" title="No matches" description="Adjust the search to see categories." />
          )}
        </div>
      )}

      {/* Category modal */}
      <Modal open={catOpen} onClose={() => setCatOpen(false)} title={editingCat ? 'Edit Category' : 'New Category'}>
        <form id="cat-form" onSubmit={submitCat} className="space-y-4">
          {catError && <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{catError}</div>}
          <Field label="Name"><input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className={inputCls} required placeholder="e.g. SaaS Subscriptions" /></Field>
          <Field label="Code"><input value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value })} className={inputCls} placeholder="e.g. SAAS" /></Field>
          <Field label="Description"><textarea value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} className={inputCls} rows={3} /></Field>
        </form>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => setCatOpen(false)}>Cancel</Button>
          <Button type="submit" form="cat-form" disabled={catSaving}>{catSaving ? 'Saving…' : editingCat ? 'Save Changes' : 'Create'}</Button>
        </div>
      </Modal>

      {/* Rule modal */}
      <Modal open={ruleOpen} onClose={() => setRuleOpen(false)} title={editingRule ? 'Edit Taxability Rule' : 'New Taxability Rule'}>
        <form id="rule-form" onSubmit={submitRule} className="space-y-4">
          {ruleError && <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{ruleError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select value={ruleForm.category_id} onChange={(e) => setRuleForm({ ...ruleForm, category_id: e.target.value })} className={inputCls} disabled={!!editingRule}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="State">
              <select value={ruleForm.state} onChange={(e) => setRuleForm({ ...ruleForm, state: e.target.value })} className={inputCls} disabled={!!editingRule}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Taxability">
            <select value={ruleForm.taxability} onChange={(e) => setRuleForm({ ...ruleForm, taxability: e.target.value })} className={inputCls}>
              {TAXABILITY.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          {ruleForm.taxability === 'reduced' && (
            <Field label="Reduced rate (decimal, e.g. 0.025)">
              <input value={ruleForm.reduced_rate} onChange={(e) => setRuleForm({ ...ruleForm, reduced_rate: e.target.value })} className={inputCls} inputMode="decimal" placeholder="0.025" />
            </Field>
          )}
          <Field label="Note"><textarea value={ruleForm.note} onChange={(e) => setRuleForm({ ...ruleForm, note: e.target.value })} className={inputCls} rows={2} /></Field>
          {editingRule && (
            <p className="text-xs text-slate-500">Category and state are fixed for an existing rule (unique per category+state). Delete and recreate to move it.</p>
          )}
        </form>
        <div className="mt-5 flex justify-between gap-3">
          <div>
            {editingRule && (
              <Button variant="danger" type="button" onClick={() => { const r = editingRule; setRuleOpen(false); removeRule(r) }}>Delete</Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={() => setRuleOpen(false)}>Cancel</Button>
            <Button type="submit" form="rule-form" disabled={ruleSaving}>{ruleSaving ? 'Saving…' : editingRule ? 'Save Changes' : 'Create'}</Button>
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

function Legend({ tone, label }: { tone: 'rose' | 'green' | 'amber' | 'blue'; label: string }) {
  const dot = tone === 'rose' ? 'bg-rose-500' : tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-sky-500'
  return <span className="inline-flex items-center gap-1 text-slate-400"><span className={`h-2.5 w-2.5 rounded-sm ${dot}`} />{label}</span>
}
