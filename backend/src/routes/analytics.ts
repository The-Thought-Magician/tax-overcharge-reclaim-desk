import { Hono } from 'hono'
import { db } from '../db/index.js'
import { findings, claims, vendors } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const router = new Hono()

// Statuses that count as "still recoverable / in pursuit" vs terminal.
const RECOVERED_STATUSES = new Set(['recovered', 'closed'])
const DEAD_STATUSES = new Set(['written_off', 'rejected'])

// Public: recovery KPI overview
router.get('/overview', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const allFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.workspace_id, workspaceId))

  const allClaims = await db
    .select()
    .from(claims)
    .where(eq(claims.workspace_id, workspaceId))

  let totalClaimableCents = 0
  let atRiskCents = 0
  const now = Date.now()
  const RISK_WINDOW_MS = 90 * 86_400_000

  for (const f of allFindings) {
    const rec = f.recoverable_cents ?? 0
    totalClaimableCents += rec
    // At risk = open finding whose statute deadline is within 90 days (or already past).
    if (!RECOVERED_STATUSES.has(f.status) && !DEAD_STATUSES.has(f.status)) {
      if (f.statute_deadline) {
        const dl = new Date(f.statute_deadline).getTime()
        if (!Number.isNaN(dl) && dl - now <= RISK_WINDOW_MS) atRiskCents += rec
      }
    }
  }

  let totalRecoveredCents = 0
  let totalExpectedCents = 0
  for (const cl of allClaims) {
    totalRecoveredCents += cl.recovered_cents ?? 0
    totalExpectedCents += cl.expected_cents ?? 0
  }

  const recoveryRate = totalClaimableCents > 0 ? totalRecoveredCents / totalClaimableCents : 0
  // Leakage = share of identified claimable that is dead/written-off (lost forever).
  let leakageCents = 0
  for (const f of allFindings) {
    if (DEAD_STATUSES.has(f.status)) leakageCents += f.recoverable_cents ?? 0
  }
  const leakageRate = totalClaimableCents > 0 ? leakageCents / totalClaimableCents : 0

  return c.json({
    total_claimable_cents: totalClaimableCents,
    total_recovered_cents: totalRecoveredCents,
    total_expected_cents: totalExpectedCents,
    recovery_rate: recoveryRate,
    at_risk_cents: atRiskCents,
    leakage_cents: leakageCents,
    leakage_rate: leakageRate,
    finding_count: allFindings.length,
    claim_count: allClaims.length,
  })
})

interface BreakdownRow {
  key: string
  label: string
  recoverable_cents: number
  recovered_cents: number
  finding_count: number
}

// Public: breakdown by dimension (type | vendor | jurisdiction | period)
router.get('/breakdown', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const dimension = c.req.query('dimension') ?? 'type'
  const allowed = ['type', 'vendor', 'jurisdiction', 'period']
  if (!allowed.includes(dimension)) {
    return c.json({ error: `dimension must be one of ${allowed.join(', ')}` }, 400)
  }

  const allFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.workspace_id, workspaceId))

  let vendorName = new Map<string, string>()
  if (dimension === 'vendor') {
    const vendorRows = await db
      .select()
      .from(vendors)
      .where(eq(vendors.workspace_id, workspaceId))
    for (const v of vendorRows) vendorName.set(v.id, v.name)
  }

  const buckets = new Map<string, BreakdownRow>()
  for (const f of allFindings) {
    let key: string
    let label: string
    if (dimension === 'type') {
      key = f.type
      label = f.type
    } else if (dimension === 'vendor') {
      key = f.vendor_id ?? '__unassigned__'
      label = f.vendor_id ? (vendorName.get(f.vendor_id) ?? 'Unknown vendor') : 'Unassigned'
    } else if (dimension === 'jurisdiction') {
      key = f.jurisdiction ?? '__none__'
      label = f.jurisdiction ?? 'No jurisdiction'
    } else {
      // period: YYYY-MM of transaction_date (fall back to created_at)
      const d = f.transaction_date ? new Date(f.transaction_date) : new Date(f.created_at)
      if (Number.isNaN(d.getTime())) {
        key = 'unknown'
        label = 'Unknown period'
      } else {
        const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        key = m
        label = m
      }
    }

    let row = buckets.get(key)
    if (!row) {
      row = { key, label, recoverable_cents: 0, recovered_cents: 0, finding_count: 0 }
      buckets.set(key, row)
    }
    const rec = f.recoverable_cents ?? 0
    row.recoverable_cents += rec
    row.finding_count += 1
    if (RECOVERED_STATUSES.has(f.status)) row.recovered_cents += rec
  }

  const result = [...buckets.values()]
  if (dimension === 'period') {
    result.sort((a, b) => a.key.localeCompare(b.key))
  } else {
    result.sort((a, b) => b.recoverable_cents - a.recoverable_cents)
  }

  return c.json(result)
})

export default router
