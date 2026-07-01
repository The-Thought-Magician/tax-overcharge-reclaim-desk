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

interface Workspace {
  id: string
  name: string
  legal_entity: string | null
  nexus_states: string[] | null
  permits: Record<string, unknown>[] | null
  fiscal_year_start_month: number | null
  default_ship_to: Record<string, unknown> | null
  created_by: string | null
  created_at: string
}

interface Member {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at: string
}

interface Subscription {
  id: string
  user_id: string
  plan_id: string
  status: string | null
  current_period_end: string | null
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface BillingInfo {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled: boolean
}

interface LogEntry {
  id: string
  workspace_id: string
  user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  detail: Record<string, unknown> | null
  created_at: string
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const TABS = [
  { id: 'profile', label: 'Workspace' },
  { id: 'members', label: 'Members' },
  { id: 'data', label: 'Sample Data' },
  { id: 'billing', label: 'Billing' },
  { id: 'activity', label: 'Activity Log' },
] as const

type TabId = (typeof TABS)[number]['id']

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function roleTone(role: string): 'teal' | 'green' | 'amber' | 'slate' {
  switch (role) {
    case 'owner':
      return 'teal'
    case 'admin':
      return 'green'
    case 'member':
      return 'amber'
    default:
      return 'slate'
  }
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('profile')

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // profile form
  const [profile, setProfile] = useState({
    name: '',
    legal_entity: '',
    nexus_states: '',
    fiscal_year_start_month: 1,
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [profileErr, setProfileErr] = useState<string | null>(null)

  // create workspace
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', legal_entity: '' })
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  // members
  const [members, setMembers] = useState<Member[] | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'member' })
  const [addingMember, setAddingMember] = useState(false)
  const [memberErr, setMemberErr] = useState<string | null>(null)

  // seed
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [seedErr, setSeedErr] = useState<string | null>(null)

  // billing
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingErr, setBillingErr] = useState<string | null>(null)
  const [billingBusy, setBillingBusy] = useState(false)

  // activity
  const [activity, setActivity] = useState<LogEntry[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityErr, setActivityErr] = useState<string | null>(null)
  const [activitySearch, setActivitySearch] = useState('')

  function applyProfile(ws: Workspace) {
    setProfile({
      name: ws.name ?? '',
      legal_entity: ws.legal_entity ?? '',
      nexus_states: Array.isArray(ws.nexus_states) ? ws.nexus_states.join(', ') : '',
      fiscal_year_start_month: ws.fiscal_year_start_month ?? 1,
    })
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let wsId = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const list = await api.getWorkspaces()
        const arr: Workspace[] = Array.isArray(list) ? list : []
        if (!active) return
        setWorkspaces(arr)
        if (arr.length === 0) {
          setLoading(false)
          return
        }
        if (!wsId || !arr.some((w) => w.id === wsId)) {
          wsId = arr[0].id
          if (typeof window !== 'undefined' && wsId) localStorage.setItem(WS_KEY, wsId)
        }
        setWorkspaceId(wsId)
        const ws = await api.getWorkspace(wsId as string)
        if (!active) return
        setWorkspace(ws)
        applyProfile(ws)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load settings')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function switchWorkspace(id: string) {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, id)
    setMembers(null)
    setBilling(null)
    setActivity(null)
    try {
      const ws = await api.getWorkspace(id)
      setWorkspace(ws)
      applyProfile(ws)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    }
  }

  // lazy-load per tab
  useEffect(() => {
    if (!workspaceId) return
    if (tab === 'members' && members === null && !membersLoading) {
      setMembersLoading(true)
      setMemberErr(null)
      api
        .getWorkspaceMembers(workspaceId)
        .then((m) => setMembers(Array.isArray(m) ? m : []))
        .catch((e) => setMemberErr(e instanceof Error ? e.message : 'Failed to load members'))
        .finally(() => setMembersLoading(false))
    }
    if (tab === 'billing' && billing === null && !billingLoading) {
      setBillingLoading(true)
      setBillingErr(null)
      api
        .getBillingPlan()
        .then((b) => setBilling(b))
        .catch((e) => setBillingErr(e instanceof Error ? e.message : 'Failed to load billing'))
        .finally(() => setBillingLoading(false))
    }
    if (tab === 'activity' && activity === null && !activityLoading) {
      setActivityLoading(true)
      setActivityErr(null)
      api
        .getActivityLog({ workspaceId })
        .then((a) => setActivity(Array.isArray(a) ? a : []))
        .catch((e) => setActivityErr(e instanceof Error ? e.message : 'Failed to load activity'))
        .finally(() => setActivityLoading(false))
    }
  }, [tab, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setSavingProfile(true)
    setProfileMsg(null)
    setProfileErr(null)
    try {
      const nexus = profile.nexus_states
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      const updated: Workspace = await api.updateWorkspace(workspaceId, {
        name: profile.name.trim(),
        legal_entity: profile.legal_entity.trim() || null,
        nexus_states: nexus,
        fiscal_year_start_month: Number(profile.fiscal_year_start_month),
      })
      setWorkspace(updated)
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
      applyProfile(updated)
      setProfileMsg('Workspace profile saved.')
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateErr(null)
    try {
      const created: Workspace = await api.createWorkspace({
        name: createForm.name.trim(),
        legal_entity: createForm.legal_entity.trim() || null,
      })
      setWorkspaces((prev) => [created, ...prev])
      setCreateForm({ name: '', legal_entity: '' })
      setCreateOpen(false)
      await switchWorkspace(created.id)
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setAddingMember(true)
    setMemberErr(null)
    try {
      const created: Member = await api.addWorkspaceMember(workspaceId, {
        user_id: memberForm.user_id.trim(),
        role: memberForm.role,
      })
      setMembers((prev) => [created, ...(prev ?? [])])
      setMemberForm({ user_id: '', role: 'member' })
      setMemberOpen(false)
    } catch (err) {
      setMemberErr(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleSeed() {
    if (!workspaceId) return
    if (!confirm('Generate sample audit data into this workspace? This adds vendors, invoices, jurisdictions, certificates and more.')) return
    setSeeding(true)
    setSeedResult(null)
    setSeedErr(null)
    try {
      const res = await api.seedSampleData({ workspace_id: workspaceId })
      const result = (res ?? {}) as { created?: unknown; skipped?: boolean; reason?: string }
      if (result.skipped) {
        setSeedResult(result.reason ?? 'Skipped: workspace already has data.')
      } else if (result.created && typeof result.created === 'object') {
        const parts = Object.entries(result.created as Record<string, unknown>)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')
        setSeedResult(parts ? `Created ${parts}.` : 'Sample data generated.')
      } else {
        setSeedResult('Sample data generated.')
      }
    } catch (err) {
      setSeedErr(err instanceof Error ? err.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  async function handleCheckout() {
    setBillingBusy(true)
    setBillingErr(null)
    try {
      const res = await api.createCheckout()
      const url = res && typeof res === 'object' ? (res as { url?: string }).url : null
      if (url) {
        window.location.href = url
      } else {
        setBillingErr('Checkout is not available right now.')
      }
    } catch (err) {
      setBillingErr(err instanceof Error ? err.message : 'Checkout is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handlePortal() {
    setBillingBusy(true)
    setBillingErr(null)
    try {
      const res = await api.createPortal()
      const url = res && typeof res === 'object' ? (res as { url?: string }).url : null
      if (url) {
        window.location.href = url
      } else {
        setBillingErr('Billing portal is not available right now.')
      }
    } catch (err) {
      setBillingErr(err instanceof Error ? err.message : 'Billing portal is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  const filteredActivity = useMemo(() => {
    if (!activity) return []
    const q = activitySearch.trim().toLowerCase()
    if (!q) return activity
    return activity.filter((a) =>
      [a.entity_type, a.entity_id, a.action, a.user_id].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [activity, activitySearch])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading settings…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-900/60 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load settings</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
        </Card>
      </div>
    )
  }

  if (workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">Create your first workspace to begin auditing tax overcharges.</p>
        </div>
        <EmptyState
          icon="🏢"
          title="No workspace yet"
          description="A workspace holds your vendors, invoices, jurisdictions, findings, and claims."
          action={<Button onClick={() => { setCreateErr(null); setCreateOpen(true) }}>Create Workspace</Button>}
        />
        <CreateWorkspaceModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreateWorkspace}
          creating={creating}
          error={createErr}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">Workspace profile, members, sample data, billing, and audit trail.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={workspaceId ?? ''}
            onChange={(e) => switchWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => { setCreateErr(null); setCreateOpen(true) }}>
            + New Workspace
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-teal-500 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card className="p-6">
          <form onSubmit={handleSaveProfile} className="max-w-2xl space-y-4">
            {profileErr && (
              <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                {profileErr}
              </div>
            )}
            {profileMsg && (
              <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                {profileMsg}
              </div>
            )}
            <Field label="Workspace Name" required>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Legal Entity">
              <input
                value={profile.legal_entity}
                onChange={(e) => setProfile({ ...profile, legal_entity: e.target.value })}
                placeholder="Acme Holdings, Inc."
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nexus States" hint="comma separated, e.g. CA, NY, TX">
                <input
                  value={profile.nexus_states}
                  onChange={(e) => setProfile({ ...profile, nexus_states: e.target.value })}
                  placeholder="CA, NY, TX"
                  className={inputCls}
                />
              </Field>
              <Field label="Fiscal Year Start">
                <select
                  value={profile.fiscal_year_start_month}
                  onChange={(e) => setProfile({ ...profile, fiscal_year_start_month: Number(e.target.value) })}
                  className={inputCls}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={savingProfile || !profile.name.trim()}>
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </Button>
              {workspace && (
                <span className="text-xs text-slate-500">
                  Created {new Date(workspace.created_at).toLocaleDateString()} · ID {workspace.id}
                </span>
              )}
            </div>
          </form>
        </Card>
      )}

      {tab === 'members' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Members</h2>
            <Button onClick={() => { setMemberErr(null); setMemberOpen(true) }}>+ Add Member</Button>
          </div>
          {membersLoading ? (
            <div className="py-12"><Spinner label="Loading members…" /></div>
          ) : memberErr && members === null ? (
            <Card className="border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-300">{memberErr}</Card>
          ) : !members || members.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No members yet"
              description="Add teammates by their user ID to collaborate on audits and claims."
              action={<Button onClick={() => setMemberOpen(true)}>Add Member</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User ID</TH>
                  <TH>Role</TH>
                  <TH>Joined</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-mono text-xs">{m.user_id}</TD>
                    <TD><Badge tone={roleTone(m.role)} className="capitalize">{m.role}</Badge></TD>
                    <TD className="text-slate-400">{new Date(m.created_at).toLocaleDateString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      )}

      {tab === 'data' && (
        <Card className="p-6">
          <div className="max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Seed Sample Data</h2>
              <p className="mt-1 text-sm text-slate-400">
                Populate this workspace with realistic demo data: vendors, invoices with line items,
                jurisdictions and rates, product categories with taxability rules, exemption certificates,
                statute-of-limitations rules, and use-tax entries. Run an audit afterward to generate findings.
              </p>
            </div>
            {seedErr && (
              <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                {seedErr}
              </div>
            )}
            {seedResult && (
              <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                {seedResult}
              </div>
            )}
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Generating…' : 'Generate Sample Data'}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'billing' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Billing</h2>
          {billingLoading ? (
            <div className="py-12"><Spinner label="Loading billing…" /></div>
          ) : billingErr && billing === null ? (
            <Card className="border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-300">{billingErr}</Card>
          ) : billing ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                  label="Current Plan"
                  value={billing.plan?.name ?? billing.subscription?.plan_id ?? 'Free'}
                  tone="teal"
                />
                <Stat
                  label="Price"
                  value={billing.plan ? (billing.plan.price_cents === 0 ? 'Free' : `${dollars(billing.plan.price_cents)}/mo`) : 'Free'}
                />
                <Stat
                  label="Status"
                  value={billing.subscription?.status ?? 'active'}
                  tone={billing.subscription?.status === 'active' || !billing.subscription ? 'green' : 'amber'}
                />
              </div>
              <Card className="p-6">
                <div className="space-y-4">
                  {!billing.stripeEnabled && (
                    <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
                      Stripe is not configured on this deployment. Plan changes are unavailable.
                    </div>
                  )}
                  {billing.subscription?.current_period_end && (
                    <p className="text-sm text-slate-400">
                      Current period ends {new Date(billing.subscription.current_period_end).toLocaleDateString()}.
                    </p>
                  )}
                  {billingErr && (
                    <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                      {billingErr}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleCheckout} disabled={billingBusy || !billing.stripeEnabled}>
                      {billingBusy ? 'Working…' : 'Upgrade to Pro'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handlePortal}
                      disabled={billingBusy || !billing.stripeEnabled}
                    >
                      Manage Billing
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Activity Log</h2>
            <input
              value={activitySearch}
              onChange={(e) => setActivitySearch(e.target.value)}
              placeholder="Search action, entity, user…"
              className="min-w-[240px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-teal-500 focus:outline-none"
            />
          </div>
          {activityLoading ? (
            <div className="py-12"><Spinner label="Loading activity…" /></div>
          ) : activityErr && activity === null ? (
            <Card className="border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-300">{activityErr}</Card>
          ) : !activity || activity.length === 0 ? (
            <EmptyState
              icon="📜"
              title="No activity yet"
              description="Workspace changes will appear here as you create vendors, run audits, and file claims."
            />
          ) : filteredActivity.length === 0 ? (
            <EmptyState icon="🔍" title="No matches" description="No log entries match your search." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>User</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {filteredActivity.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap text-slate-400">{new Date(a.created_at).toLocaleString()}</TD>
                    <TD><Badge tone="teal">{a.action}</Badge></TD>
                    <TD>
                      <span className="capitalize text-slate-300">{a.entity_type}</span>
                      {a.entity_id && <div className="font-mono text-xs text-slate-600">{a.entity_id}</div>}
                    </TD>
                    <TD className="font-mono text-xs">{a.user_id || <span className="text-slate-600">system</span>}</TD>
                    <TD>
                      {a.detail && Object.keys(a.detail).length > 0 ? (
                        <span className="font-mono text-xs text-slate-500">
                          {JSON.stringify(a.detail).slice(0, 80)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      )}

      <CreateWorkspaceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        form={createForm}
        setForm={setCreateForm}
        onSubmit={handleCreateWorkspace}
        creating={creating}
        error={createErr}
      />

      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="Add Member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMemberOpen(false)}>Cancel</Button>
            <Button form="member-form" type="submit" disabled={addingMember || !memberForm.user_id.trim()}>
              {addingMember ? 'Adding…' : 'Add Member'}
            </Button>
          </>
        }
      >
        <form id="member-form" onSubmit={handleAddMember} className="space-y-4">
          {memberErr && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {memberErr}
            </div>
          )}
          <Field label="User ID" required hint="the teammate's auth user id">
            <input
              value={memberForm.user_id}
              onChange={(e) => setMemberForm({ ...memberForm, user_id: e.target.value })}
              required
              className={`${inputCls} font-mono`}
            />
          </Field>
          <Field label="Role" required>
            <select
              value={memberForm.role}
              onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
              className={inputCls}
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </Field>
        </form>
      </Modal>
    </div>
  )
}

function CreateWorkspaceModal({
  open,
  onClose,
  form,
  setForm,
  onSubmit,
  creating,
  error,
}: {
  open: boolean
  onClose: () => void
  form: { name: string; legal_entity: string }
  setForm: (f: { name: string; legal_entity: string }) => void
  onSubmit: (e: React.FormEvent) => void
  creating: boolean
  error: string | null
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Workspace"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button form="workspace-form" type="submit" disabled={creating || !form.name.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="workspace-form" onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        <Field label="Workspace Name" required>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="Acme Tax Recovery"
            className={inputCls}
          />
        </Field>
        <Field label="Legal Entity">
          <input
            value={form.legal_entity}
            onChange={(e) => setForm({ ...form, legal_entity: e.target.value })}
            placeholder="Acme Holdings, Inc."
            className={inputCls}
          />
        </Field>
      </form>
    </Modal>
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
