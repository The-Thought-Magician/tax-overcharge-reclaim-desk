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

interface Jurisdiction {
  id: string
  workspace_id: string
  code: string
  state: string
  county: string | null
  city: string | null
  freight_taxable: boolean
  labor_taxable: boolean
  saas_taxable: boolean
  created_at: string
}

interface Rate {
  id: string
  workspace_id: string
  jurisdiction_id: string
  state_rate: number
  county_rate: number
  city_rate: number
  district_rate: number
  combined_rate: number
  effective_from: string | null
  effective_to: string | null
  created_at: string
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

function pct(r: number | null | undefined): string {
  if (r === null || r === undefined || Number.isNaN(r)) return '—'
  // rates stored as decimals (e.g. 0.0725) or already percent? Treat <=1 as decimal.
  const v = r <= 1 ? r * 100 : r
  return `${v.toFixed(3)}%`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const EMPTY_JUR = {
  code: '',
  state: 'CA',
  county: '',
  city: '',
  freight_taxable: false,
  labor_taxable: false,
  saas_taxable: false,
}

const EMPTY_RATE = {
  state_rate: '',
  county_rate: '',
  city_rate: '',
  district_rate: '',
  effective_from: '',
  effective_to: '',
}

export default function JurisdictionsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([])
  const [ratesByJur, setRatesByJur] = useState<Record<string, Rate[]>>({})

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // jurisdiction form
  const [jurOpen, setJurOpen] = useState(false)
  const [editingJur, setEditingJur] = useState<Jurisdiction | null>(null)
  const [jurForm, setJurForm] = useState(EMPTY_JUR)
  const [jurSaving, setJurSaving] = useState(false)
  const [jurError, setJurError] = useState<string | null>(null)

  // rate form
  const [rateOpen, setRateOpen] = useState(false)
  const [editingRate, setEditingRate] = useState<Rate | null>(null)
  const [rateJurId, setRateJurId] = useState<string | null>(null)
  const [rateForm, setRateForm] = useState(EMPTY_RATE)
  const [rateSaving, setRateSaving] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)

  // lookup tool
  const [lookup, setLookup] = useState({ state: '', county: '', city: '' })
  const [lookupResult, setLookupResult] = useState<Jurisdiction | null | 'none'>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const loadRatesFor = useCallback(async (jurId: string) => {
    try {
      const rates = await api.getRates(jurId)
      setRatesByJur((prev) => ({ ...prev, [jurId]: Array.isArray(rates) ? rates : [] }))
    } catch {
      setRatesByJur((prev) => ({ ...prev, [jurId]: [] }))
    }
  }, [])

  const loadAll = useCallback(async (wsId: string) => {
    const jurs = await api.getJurisdictions(wsId)
    const list: Jurisdiction[] = Array.isArray(jurs) ? jurs : []
    setJurisdictions(list)
    // preload rates for all jurisdictions
    const entries = await Promise.all(
      list.map(async (j) => {
        try {
          const r = await api.getRates(j.id)
          return [j.id, Array.isArray(r) ? r : []] as const
        } catch {
          return [j.id, [] as Rate[]] as const
        }
      })
    )
    setRatesByJur(Object.fromEntries(entries))
    if (list.length && !selectedId) setSelectedId(list[0].id)
  }, [selectedId])

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
        if (active) setError(e instanceof Error ? e.message : 'Failed to load jurisdictions')
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

  // Jurisdiction CRUD
  const openCreateJur = () => {
    setEditingJur(null)
    setJurForm(EMPTY_JUR)
    setJurError(null)
    setJurOpen(true)
  }
  const openEditJur = (j: Jurisdiction) => {
    setEditingJur(j)
    setJurForm({
      code: j.code,
      state: j.state,
      county: j.county ?? '',
      city: j.city ?? '',
      freight_taxable: !!j.freight_taxable,
      labor_taxable: !!j.labor_taxable,
      saas_taxable: !!j.saas_taxable,
    })
    setJurError(null)
    setJurOpen(true)
  }
  const submitJur = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setJurSaving(true)
    setJurError(null)
    try {
      const payload = {
        workspace_id: workspaceId,
        code: jurForm.code,
        state: jurForm.state,
        county: jurForm.county || null,
        city: jurForm.city || null,
        freight_taxable: jurForm.freight_taxable,
        labor_taxable: jurForm.labor_taxable,
        saas_taxable: jurForm.saas_taxable,
      }
      if (editingJur) await api.updateJurisdiction(editingJur.id, payload)
      else await api.createJurisdiction(payload)
      setJurOpen(false)
      await refresh()
    } catch (err) {
      setJurError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setJurSaving(false)
    }
  }

  // Rate CRUD
  const openCreateRate = (jurId: string) => {
    setEditingRate(null)
    setRateJurId(jurId)
    setRateForm(EMPTY_RATE)
    setRateError(null)
    setRateOpen(true)
  }
  const openEditRate = (r: Rate) => {
    setEditingRate(r)
    setRateJurId(r.jurisdiction_id)
    setRateForm({
      state_rate: String(r.state_rate ?? ''),
      county_rate: String(r.county_rate ?? ''),
      city_rate: String(r.city_rate ?? ''),
      district_rate: String(r.district_rate ?? ''),
      effective_from: r.effective_from ? r.effective_from.slice(0, 10) : '',
      effective_to: r.effective_to ? r.effective_to.slice(0, 10) : '',
    })
    setRateError(null)
    setRateOpen(true)
  }
  const num = (s: string) => {
    if (s.trim() === '') return 0
    const v = parseFloat(s)
    return Number.isNaN(v) ? 0 : v
  }
  const submitRate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || !rateJurId) return
    setRateSaving(true)
    setRateError(null)
    try {
      const sr = num(rateForm.state_rate)
      const cor = num(rateForm.county_rate)
      const cir = num(rateForm.city_rate)
      const dr = num(rateForm.district_rate)
      const payload = {
        workspace_id: workspaceId,
        jurisdiction_id: rateJurId,
        state_rate: sr,
        county_rate: cor,
        city_rate: cir,
        district_rate: dr,
        combined_rate: sr + cor + cir + dr,
        effective_from: rateForm.effective_from || null,
        effective_to: rateForm.effective_to || null,
      }
      if (editingRate) await api.updateRate(editingRate.id, payload)
      else await api.createRate(payload)
      setRateOpen(false)
      await loadRatesFor(rateJurId)
    } catch (err) {
      setRateError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setRateSaving(false)
    }
  }
  const removeRate = async (r: Rate) => {
    if (!confirm('Delete this rate row?')) return
    try {
      await api.deleteRate(r.id)
      await loadRatesFor(r.jurisdiction_id)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const runLookup = async () => {
    setLookupLoading(true)
    setLookupResult(null)
    try {
      const res = await api.lookupJurisdiction({
        state: lookup.state || undefined,
        county: lookup.county || undefined,
        city: lookup.city || undefined,
      })
      setLookupResult(res ?? 'none')
    } catch {
      setLookupResult('none')
    } finally {
      setLookupLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jurisdictions.filter((j) => {
      if (stateFilter && j.state !== stateFilter) return false
      if (q) {
        const hay = `${j.code} ${j.state} ${j.county ?? ''} ${j.city ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [jurisdictions, search, stateFilter])

  const selected = useMemo(() => jurisdictions.find((j) => j.id === selectedId) ?? null, [jurisdictions, selectedId])
  const selectedRates = selectedId ? (ratesByJur[selectedId] ?? []) : []

  const stats = useMemo(() => {
    const states = new Set(jurisdictions.map((j) => j.state)).size
    const totalRates = Object.values(ratesByJur).reduce((a, r) => a + r.length, 0)
    const combinedRates = Object.values(ratesByJur).flat().map((r) => (r.combined_rate <= 1 ? r.combined_rate * 100 : r.combined_rate))
    const avg = combinedRates.length ? combinedRates.reduce((a, b) => a + b, 0) / combinedRates.length : 0
    const max = combinedRates.length ? Math.max(...combinedRates) : 0
    return { count: jurisdictions.length, states, totalRates, avg, max }
  }, [jurisdictions, ratesByJur])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner label="Loading jurisdictions…" /></div>
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load jurisdictions</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <div className="mt-4"><Button variant="secondary" onClick={() => location.reload()}>Retry</Button></div>
        </Card>
      </div>
    )
  }

  if (!workspaceId) {
    return <div className="mx-auto max-w-xl"><EmptyState icon="🗺️" title="No workspace yet" description="Create a workspace from Settings before managing jurisdictions." /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Jurisdictions &amp; Rate Tables</h1>
          <p className="mt-1 text-sm text-slate-400">Tax jurisdictions, taxability flags, and effective-dated combined rate tables.</p>
        </div>
        <Button onClick={openCreateJur}>+ New Jurisdiction</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Jurisdictions" value={stats.count} />
        <Stat label="States" value={stats.states} tone="teal" />
        <Stat label="Rate Rows" value={stats.totalRates} />
        <Stat label="Avg Combined" value={`${stats.avg.toFixed(2)}%`} tone="amber" />
        <Stat label="Max Combined" value={`${stats.max.toFixed(2)}%`} tone="rose" />
      </div>

      {/* Lookup tool */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-white">Jurisdiction Lookup</h2>
        <p className="mt-0.5 text-xs text-slate-500">Resolve a ship-to location to its registered jurisdiction.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="State" className="w-28">
            <select value={lookup.state} onChange={(e) => setLookup({ ...lookup, state: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="County" className="flex-1 min-w-[140px]">
            <input value={lookup.county} onChange={(e) => setLookup({ ...lookup, county: e.target.value })} className={inputCls} placeholder="e.g. Los Angeles" />
          </Field>
          <Field label="City" className="flex-1 min-w-[140px]">
            <input value={lookup.city} onChange={(e) => setLookup({ ...lookup, city: e.target.value })} className={inputCls} placeholder="e.g. Pasadena" />
          </Field>
          <Button onClick={runLookup} disabled={lookupLoading}>{lookupLoading ? 'Looking…' : 'Lookup'}</Button>
        </div>
        {lookupResult !== null && (
          <div className="mt-4">
            {lookupResult === 'none' ? (
              <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
                No matching jurisdiction found. Consider adding one.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-teal-900 bg-teal-950/30 px-4 py-3 text-sm">
                <Badge tone="teal">{lookupResult.code}</Badge>
                <span className="text-slate-200">{[lookupResult.city, lookupResult.county, lookupResult.state].filter(Boolean).join(', ')}</span>
                <button className="text-teal-400 hover:underline" onClick={() => setSelectedId(lookupResult.id)}>view rates →</button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, county, city…" className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">All states</option>
            {Array.from(new Set(jurisdictions.map((j) => j.state))).sort().map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || stateFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setStateFilter('') }}>Clear</Button>}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Jurisdiction list */}
        <div className="lg:col-span-3">
          {filtered.length === 0 ? (
            <EmptyState
              icon="🗺️"
              title={jurisdictions.length === 0 ? 'No jurisdictions yet' : 'No matches'}
              description={jurisdictions.length === 0 ? 'Add a jurisdiction to begin building rate tables.' : 'Adjust the filters.'}
              action={jurisdictions.length === 0 ? <Button onClick={openCreateJur}>+ New Jurisdiction</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Location</TH>
                  <TH>Flags</TH>
                  <TH>Current Combined</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((j) => {
                  const rates = ratesByJur[j.id] ?? []
                  const current = rates.find((r) => {
                    const from = r.effective_from ? new Date(r.effective_from).getTime() : -Infinity
                    const to = r.effective_to ? new Date(r.effective_to).getTime() : Infinity
                    const now = Date.now()
                    return now >= from && now <= to
                  }) ?? rates[0]
                  return (
                    <TR key={j.id} className={selectedId === j.id ? 'bg-slate-900/60' : ''}>
                      <TD className="font-medium text-slate-100">
                        <button className="hover:text-teal-300" onClick={() => setSelectedId(j.id)}>{j.code}</button>
                      </TD>
                      <TD>{[j.city, j.county, j.state].filter(Boolean).join(', ') || j.state}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {j.freight_taxable && <Badge tone="amber">freight</Badge>}
                          {j.labor_taxable && <Badge tone="amber">labor</Badge>}
                          {j.saas_taxable && <Badge tone="amber">SaaS</Badge>}
                          {!j.freight_taxable && !j.labor_taxable && !j.saas_taxable && <span className="text-xs text-slate-600">none taxable</span>}
                        </div>
                      </TD>
                      <TD className="tabular-nums">{current ? pct(current.combined_rate) : <span className="text-slate-500">no rate</span>}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" className="px-2 py-1" onClick={() => setSelectedId(j.id)}>Rates</Button>
                          <Button variant="ghost" className="px-2 py-1" onClick={() => openEditJur(j)}>Edit</Button>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </div>

        {/* Rate table panel */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            {!selected ? (
              <p className="text-sm text-slate-500">Select a jurisdiction to view its effective-dated rate table.</p>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white">{selected.code}</h2>
                    <p className="text-xs text-slate-500">{[selected.city, selected.county, selected.state].filter(Boolean).join(', ') || selected.state}</p>
                  </div>
                  <Button className="px-2 py-1 text-xs" onClick={() => openCreateRate(selected.id)}>+ Rate</Button>
                </div>
                <div className="mt-4 space-y-3">
                  {selectedRates.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-sm text-slate-500">No rates configured.</p>
                  ) : (
                    selectedRates.map((r) => (
                      <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold tabular-nums text-teal-300">{pct(r.combined_rate)}</span>
                          <div className="flex gap-1">
                            <button className="text-xs text-slate-400 hover:text-white" onClick={() => openEditRate(r)}>edit</button>
                            <button className="text-xs text-rose-400 hover:text-rose-300" onClick={() => removeRate(r)}>del</button>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-400">
                          <span>State: {pct(r.state_rate)}</span>
                          <span>County: {pct(r.county_rate)}</span>
                          <span>City: {pct(r.city_rate)}</span>
                          <span>District: {pct(r.district_rate)}</span>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Effective {fmtDate(r.effective_from)} → {fmtDate(r.effective_to)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Jurisdiction modal */}
      <Modal open={jurOpen} onClose={() => setJurOpen(false)} title={editingJur ? 'Edit Jurisdiction' : 'New Jurisdiction'}>
        <form id="jur-form" onSubmit={submitJur} className="space-y-4">
          {jurError && <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{jurError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code">
              <input value={jurForm.code} onChange={(e) => setJurForm({ ...jurForm, code: e.target.value })} className={inputCls} placeholder="e.g. CA-LA-PASADENA" required />
            </Field>
            <Field label="State">
              <select value={jurForm.state} onChange={(e) => setJurForm({ ...jurForm, state: e.target.value })} className={inputCls}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="County">
              <input value={jurForm.county} onChange={(e) => setJurForm({ ...jurForm, county: e.target.value })} className={inputCls} />
            </Field>
            <Field label="City">
              <input value={jurForm.city} onChange={(e) => setJurForm({ ...jurForm, city: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox label="Freight taxable" checked={jurForm.freight_taxable} onChange={(v) => setJurForm({ ...jurForm, freight_taxable: v })} />
            <Checkbox label="Labor taxable" checked={jurForm.labor_taxable} onChange={(v) => setJurForm({ ...jurForm, labor_taxable: v })} />
            <Checkbox label="SaaS taxable" checked={jurForm.saas_taxable} onChange={(v) => setJurForm({ ...jurForm, saas_taxable: v })} />
          </div>
        </form>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => setJurOpen(false)}>Cancel</Button>
          <Button type="submit" form="jur-form" disabled={jurSaving}>{jurSaving ? 'Saving…' : editingJur ? 'Save Changes' : 'Create'}</Button>
        </div>
      </Modal>

      {/* Rate modal */}
      <Modal open={rateOpen} onClose={() => setRateOpen(false)} title={editingRate ? 'Edit Rate' : 'New Rate'}>
        <form id="rate-form" onSubmit={submitRate} className="space-y-4">
          {rateError && <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{rateError}</div>}
          <p className="text-xs text-slate-500">Enter component rates as decimals (e.g. 0.0625 for 6.25%). Combined rate is computed automatically.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State rate"><input value={rateForm.state_rate} onChange={(e) => setRateForm({ ...rateForm, state_rate: e.target.value })} className={inputCls} placeholder="0.0625" inputMode="decimal" /></Field>
            <Field label="County rate"><input value={rateForm.county_rate} onChange={(e) => setRateForm({ ...rateForm, county_rate: e.target.value })} className={inputCls} placeholder="0.0025" inputMode="decimal" /></Field>
            <Field label="City rate"><input value={rateForm.city_rate} onChange={(e) => setRateForm({ ...rateForm, city_rate: e.target.value })} className={inputCls} placeholder="0.0100" inputMode="decimal" /></Field>
            <Field label="District rate"><input value={rateForm.district_rate} onChange={(e) => setRateForm({ ...rateForm, district_rate: e.target.value })} className={inputCls} placeholder="0.0050" inputMode="decimal" /></Field>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
            Combined: <span className="font-bold tabular-nums text-teal-300">{pct(num(rateForm.state_rate) + num(rateForm.county_rate) + num(rateForm.city_rate) + num(rateForm.district_rate))}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Effective from"><input type="date" value={rateForm.effective_from} onChange={(e) => setRateForm({ ...rateForm, effective_from: e.target.value })} className={inputCls} /></Field>
            <Field label="Effective to"><input type="date" value={rateForm.effective_to} onChange={(e) => setRateForm({ ...rateForm, effective_to: e.target.value })} className={inputCls} /></Field>
          </div>
        </form>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => setRateOpen(false)}>Cancel</Button>
          <Button type="submit" form="rate-form" disabled={rateSaving}>{rateSaving ? 'Saving…' : editingRate ? 'Save Changes' : 'Create'}</Button>
        </div>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-teal-600 focus:ring-teal-500" />
      {label}
    </label>
  )
}
