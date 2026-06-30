import { Hono } from 'hono'
import { db } from '../db/index.js'
import { findings, vendors } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const router = new Hono()

interface OffenderRow {
  vendor_id: string | null
  vendor_name: string
  total_overcharge_cents: number
  finding_count: number
  open_finding_count: number
  recovered_cents: number
  avg_confidence: number
  by_type: Array<{ type: string; count: number; overcharge_cents: number }>
}

// Public: repeat-offender vendor ranking with by-type overcharge breakdown
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(findings)
    .where(eq(findings.workspace_id, workspaceId))

  const vendorRows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.workspace_id, workspaceId))
  const vendorName = new Map<string, string>()
  for (const v of vendorRows) vendorName.set(v.id, v.name)

  // Group findings by vendor.
  const byVendor = new Map<string, {
    vendor_id: string | null
    total: number
    count: number
    open: number
    recovered: number
    confidenceSum: number
    byType: Map<string, { count: number; overcharge: number }>
  }>()

  for (const f of rows) {
    const key = f.vendor_id ?? '__unassigned__'
    let entry = byVendor.get(key)
    if (!entry) {
      entry = {
        vendor_id: f.vendor_id,
        total: 0,
        count: 0,
        open: 0,
        recovered: 0,
        confidenceSum: 0,
        byType: new Map(),
      }
      byVendor.set(key, entry)
    }
    const rec = f.recoverable_cents ?? 0
    entry.total += rec
    entry.count += 1
    entry.confidenceSum += f.confidence ?? 0
    if (f.status === 'recovered' || f.status === 'closed') entry.recovered += rec
    if (f.status !== 'recovered' && f.status !== 'closed' && f.status !== 'written_off' && f.status !== 'rejected') {
      entry.open += 1
    }
    const t = f.type
    let typeEntry = entry.byType.get(t)
    if (!typeEntry) {
      typeEntry = { count: 0, overcharge: 0 }
      entry.byType.set(t, typeEntry)
    }
    typeEntry.count += 1
    typeEntry.overcharge += rec
  }

  const result: OffenderRow[] = [...byVendor.values()].map((e) => ({
    vendor_id: e.vendor_id,
    vendor_name: e.vendor_id ? (vendorName.get(e.vendor_id) ?? 'Unknown vendor') : 'Unassigned',
    total_overcharge_cents: e.total,
    finding_count: e.count,
    open_finding_count: e.open,
    recovered_cents: e.recovered,
    avg_confidence: e.count > 0 ? e.confidenceSum / e.count : 0,
    by_type: [...e.byType.entries()]
      .map(([type, v]) => ({ type, count: v.count, overcharge_cents: v.overcharge }))
      .sort((a, b) => b.overcharge_cents - a.overcharge_cents),
  }))

  // Rank by total overcharge, then by finding count.
  result.sort((a, b) => {
    if (b.total_overcharge_cents !== a.total_overcharge_cents) {
      return b.total_overcharge_cents - a.total_overcharge_cents
    }
    return b.finding_count - a.finding_count
  })

  return c.json(result)
})

export default router
