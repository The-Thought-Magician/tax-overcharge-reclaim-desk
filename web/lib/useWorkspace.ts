'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

export interface Workspace {
  id: string
  name: string
  legal_entity?: string | null
  nexus_states?: string[] | null
  fiscal_year_start_month?: number | null
  created_at?: string
}

const STORAGE_KEY = 'torc.active_workspace'

// Resolves the active workspace for the signed-in user. Picks the
// stored workspace if it still exists, otherwise the first membership,
// otherwise bootstraps a starter workspace so the dashboard is usable.
export function useWorkspace() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        let list: Workspace[] = await api.getWorkspaces()
        if (!Array.isArray(list)) list = []
        if (list.length === 0) {
          const created: Workspace = await api.createWorkspace({
            name: 'My Workspace',
            legal_entity: 'My Company, Inc.',
            fiscal_year_start_month: 1,
          })
          list = [created]
        }
        if (!active) return
        setWorkspaces(list)
        let stored: string | null = null
        try {
          stored = localStorage.getItem(STORAGE_KEY)
        } catch {
          stored = null
        }
        const chosen = list.find((w) => w.id === stored)?.id ?? list[0].id
        setWorkspaceId(chosen)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const selectWorkspace = (id: string) => {
    setWorkspaceId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* ignore */
    }
  }

  return { workspaceId, workspaces, loading, error, selectWorkspace }
}

export default useWorkspace
