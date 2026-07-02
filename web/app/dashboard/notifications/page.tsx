'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import Card from '@/components/ui/card'
import Stat from '@/components/ui/Stat'
import Badge from '@/components/ui/Badge'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/button'

interface Notification {
  id: string
  workspace_id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

type Filter = 'all' | 'unread' | 'read'

const TYPE_TONE: Record<string, 'teal' | 'amber' | 'rose' | 'green' | 'blue' | 'slate'> = {
  statute: 'rose',
  statute_expiring: 'rose',
  certificate: 'amber',
  cert_expiring: 'amber',
  finding: 'teal',
  high_value_finding: 'teal',
  claim: 'green',
  claim_update: 'green',
  audit: 'blue',
  audit_complete: 'blue',
}

function toneFor(type: string) {
  return TYPE_TONE[type] ?? 'slate'
}

function prettyType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  // Resolve workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const ws = await api.getWorkspaces()
        if (!active) return
        const list = Array.isArray(ws) ? ws : []
        if (list.length === 0) {
          setError('NO_WORKSPACE')
          setLoading(false)
          return
        }
        const stored = typeof window !== 'undefined' ? localStorage.getItem('torq_workspace_id') : null
        const chosen = list.find((w: { id: string }) => w.id === stored)?.id ?? list[0].id
        setWorkspaceId(chosen)
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (wid: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getNotifications(wid)
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const markRead = async (id: string) => {
    setBusyId(id)
    // optimistic
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    try {
      await api.markNotificationRead(id)
    } catch {
      // revert on failure
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)))
    } finally {
      setBusyId(null)
    }
  }

  const markAll = async () => {
    if (!workspaceId) return
    setMarkingAll(true)
    const prev = items
    setItems((p) => p.map((n) => ({ ...n, read: true })))
    try {
      await api.markAllNotificationsRead({ workspace_id: workspaceId })
    } catch {
      setItems(prev)
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const filtered = useMemo(() => {
    const base =
      filter === 'unread'
        ? items.filter((n) => !n.read)
        : filter === 'read'
          ? items.filter((n) => n.read)
          : items
    return [...base].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [items, filter])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading notifications…" />
      </div>
    )
  }

  if (error === 'NO_WORKSPACE') {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings to receive notifications."
          icon={<span>🔔</span>}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <Card className="border-rose-900 bg-rose-950/30 p-6">
          <h2 className="text-base font-semibold text-rose-200">Could not load notifications</h2>
          <p className="mt-1 text-sm text-rose-300/80">{error}</p>
          <Button className="mt-4" variant="secondary" onClick={() => workspaceId && load(workspaceId)}>
            Retry
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Notifications</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Statute deadlines, expiring certificates, and high-value findings.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => workspaceId && load(workspaceId)}>
            Refresh
          </Button>
          <Button onClick={markAll} disabled={markingAll || unreadCount === 0}>
            {markingAll ? 'Marking…' : 'Mark all read'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={items.length} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount > 0 ? 'amber' : 'default'} />
        <Stat label="Read" value={items.length - unreadCount} tone="default" />
      </div>

      {/* Filters */}
      <div className="inline-flex rounded-lg border border-neutral-700 bg-neutral-900 p-1">
        {(['all', 'unread', 'read'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-orange-600 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            {f}
            {f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        ))}
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'No unread notifications' : 'No notifications'}
          description={
            filter === 'unread'
              ? "You're all caught up."
              : 'Alerts will appear here as audits run and deadlines approach.'
          }
          icon={<span>🔔</span>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <Card
              key={n.id}
              className={`flex items-start gap-4 p-4 transition-colors ${
                n.read ? 'opacity-70' : 'border-l-2 border-l-orange-500'
              }`}
            >
              {!n.read && (
                <span className="mt-2 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-orange-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneFor(n.type)}>{prettyType(n.type)}</Badge>
                  <span className="text-sm font-semibold text-neutral-100">{n.title}</span>
                  <span className="ml-auto text-xs text-neutral-500">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-sm text-neutral-400">{n.body}</p>}
                <div className="mt-2 flex items-center gap-3">
                  {n.link && (
                    <Link
                      href={n.link}
                      className="text-xs font-medium text-orange-400 hover:text-orange-300"
                    >
                      View details →
                    </Link>
                  )}
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      disabled={busyId === n.id}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
                    >
                      {busyId === n.id ? 'Marking…' : 'Mark read'}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
