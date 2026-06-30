import { Hono } from 'hono'
import { db } from '../db/index.js'
import { findings, claims, vendors, invoices } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

const RECOVERED_STATUSES = new Set(['recovered', 'closed'])
const DEAD_STATUSES = new Set(['written_off', 'rejected'])

// Public: findings export rows (?workspace_id&type&status)
router.get('/findings', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const type = c.req.query('type')
  const status = c.req.query('status')

  const conditions = [eq(findings.workspace_id, workspaceId)]
  if (type) conditions.push(eq(findings.type, type))
  if (status) conditions.push(eq(findings.status, status))

  const rows = await db
    .select()
    .from(findings)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(findings.created_at)

  const vendorRows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.workspace_id, workspaceId))
  const vendorName = new Map<string, string>()
  for (const v of vendorRows) vendorName.set(v.id, v.name)

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.workspace_id, workspaceId))
  const invoiceNumber = new Map<string, string>()
  for (const inv of invoiceRows) invoiceNumber.set(inv.id, inv.invoice_number)

  const exportRows = rows.map((f) => ({
    finding_id: f.id,
    vendor: f.vendor_id ? (vendorName.get(f.vendor_id) ?? 'Unknown vendor') : 'Unassigned',
    invoice_number: f.invoice_id ? (invoiceNumber.get(f.invoice_id) ?? '') : '',
    type: f.type,
    jurisdiction: f.jurisdiction ?? '',
    recoverable_cents: f.recoverable_cents ?? 0,
    confidence: f.confidence ?? 0,
    status: f.status,
    reason: f.reason ?? '',
    transaction_date: f.transaction_date ? new Date(f.transaction_date).toISOString() : null,
    statute_deadline: f.statute_deadline ? new Date(f.statute_deadline).toISOString() : null,
    created_at: new Date(f.created_at).toISOString(),
  }))

  return c.json(exportRows)
})

interface PeriodRow {
  period: string
  filed_count: number
  recovered_count: number
  expected_cents: number
  recovered_cents: number
  recovery_rate: number
}

// Public: recovery summary by period (?workspace_id)
router.get('/recovery', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const allClaims = await db
    .select()
    .from(claims)
    .where(eq(claims.workspace_id, workspaceId))

  const buckets = new Map<string, PeriodRow>()
  for (const cl of allClaims) {
    // Period keyed by recovered_at if present, else filed_at, else created_at.
    const basis = cl.recovered_at ?? cl.filed_at ?? cl.created_at
    const d = new Date(basis)
    const period = Number.isNaN(d.getTime())
      ? 'unknown'
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

    let row = buckets.get(period)
    if (!row) {
      row = {
        period,
        filed_count: 0,
        recovered_count: 0,
        expected_cents: 0,
        recovered_cents: 0,
        recovery_rate: 0,
      }
      buckets.set(period, row)
    }
    if (cl.filed_at) row.filed_count += 1
    if (RECOVERED_STATUSES.has(cl.status) || (cl.recovered_cents ?? 0) > 0) row.recovered_count += 1
    row.expected_cents += cl.expected_cents ?? 0
    row.recovered_cents += cl.recovered_cents ?? 0
  }

  const result = [...buckets.values()].map((r) => ({
    ...r,
    recovery_rate: r.expected_cents > 0 ? r.recovered_cents / r.expected_cents : 0,
  }))
  result.sort((a, b) => a.period.localeCompare(b.period))

  return c.json(result)
})

interface ScorecardRow {
  vendor_id: string
  vendor_name: string
  risk_score: number
  finding_count: number
  total_overcharge_cents: number
  recovered_cents: number
  open_overcharge_cents: number
  written_off_cents: number
  recovery_rate: number
  by_type: Array<{ type: string; count: number; overcharge_cents: number }>
}

// Public: vendor scorecard (?workspace_id)
router.get('/vendor-scorecard', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const vendorRows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.workspace_id, workspaceId))

  const allFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.workspace_id, workspaceId))

  const findingsByVendor = new Map<string, typeof allFindings>()
  for (const f of allFindings) {
    if (!f.vendor_id) continue
    let arr = findingsByVendor.get(f.vendor_id)
    if (!arr) {
      arr = []
      findingsByVendor.set(f.vendor_id, arr)
    }
    arr.push(f)
  }

  const result: ScorecardRow[] = vendorRows.map((v) => {
    const vf = findingsByVendor.get(v.id) ?? []
    let total = 0
    let recovered = 0
    let open = 0
    let writtenOff = 0
    const byType = new Map<string, { count: number; overcharge: number }>()
    for (const f of vf) {
      const rec = f.recoverable_cents ?? 0
      total += rec
      if (RECOVERED_STATUSES.has(f.status)) recovered += rec
      else if (DEAD_STATUSES.has(f.status)) writtenOff += rec
      else open += rec
      let te = byType.get(f.type)
      if (!te) {
        te = { count: 0, overcharge: 0 }
        byType.set(f.type, te)
      }
      te.count += 1
      te.overcharge += rec
    }
    return {
      vendor_id: v.id,
      vendor_name: v.name,
      risk_score: v.risk_score ?? 0,
      finding_count: vf.length,
      total_overcharge_cents: total,
      recovered_cents: recovered,
      open_overcharge_cents: open,
      written_off_cents: writtenOff,
      recovery_rate: total > 0 ? recovered / total : 0,
      by_type: [...byType.entries()]
        .map(([type, t]) => ({ type, count: t.count, overcharge_cents: t.overcharge }))
        .sort((a, b) => b.overcharge_cents - a.overcharge_cents),
    }
  })

  result.sort((a, b) => b.total_overcharge_cents - a.total_overcharge_cents)

  return c.json(result)
})

export default router
