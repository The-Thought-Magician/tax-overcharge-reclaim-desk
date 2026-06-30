import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  findings,
  invoices,
  invoice_lines,
  jurisdictions,
  jurisdiction_rates,
  taxability_rules,
  exemption_certificates,
  certificate_coverage,
  statute_rules,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Allowed finding status pipeline.
const FINDING_STATUSES = [
  'identified',
  'reviewing',
  'confirmed',
  'in_claim',
  'recovered',
  'written_off',
  'dismissed',
] as const

// ---------------------------------------------------------------------------
// Single-line audit (mirrors audit.ts) for re-audit of one finding
// ---------------------------------------------------------------------------

interface AuditContext {
  jurisdictionsByCode: Map<string, typeof jurisdictions.$inferSelect>
  ratesByJurisdiction: Map<string, typeof jurisdiction_rates.$inferSelect>
  taxabilityByCatState: Map<string, typeof taxability_rules.$inferSelect>
  certByVendorState: Map<string, true>
  certByCategoryState: Map<string, true>
  statuteByState: Map<string, typeof statute_rules.$inferSelect>
}

interface LineFinding {
  type: string
  jurisdiction: string | null
  recoverable_cents: number
  reason: string
  confidence: number
  audit_result: string
  trace: Array<{ step: string; detail: string }>
}

async function buildContext(workspaceId: string): Promise<AuditContext> {
  const jurs = await db.select().from(jurisdictions).where(eq(jurisdictions.workspace_id, workspaceId))
  const rates = await db
    .select()
    .from(jurisdiction_rates)
    .where(eq(jurisdiction_rates.workspace_id, workspaceId))
  const rules = await db
    .select()
    .from(taxability_rules)
    .where(eq(taxability_rules.workspace_id, workspaceId))
  const certs = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.workspace_id, workspaceId))
  const coverage = await db
    .select()
    .from(certificate_coverage)
    .where(eq(certificate_coverage.workspace_id, workspaceId))
  const statutes = await db.select().from(statute_rules).where(eq(statute_rules.workspace_id, workspaceId))

  const jurisdictionsByCode = new Map<string, typeof jurisdictions.$inferSelect>()
  for (const j of jurs) jurisdictionsByCode.set(j.code, j)

  const ratesByJurisdiction = new Map<string, typeof jurisdiction_rates.$inferSelect>()
  const sortedRates = [...rates].sort(
    (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
  )
  for (const r of sortedRates) {
    if (!ratesByJurisdiction.has(r.jurisdiction_id)) ratesByJurisdiction.set(r.jurisdiction_id, r)
  }

  const taxabilityByCatState = new Map<string, typeof taxability_rules.$inferSelect>()
  for (const r of rules) taxabilityByCatState.set(`${r.category_id}|${r.state}`, r)

  const validCertStates = new Map<string, string>()
  const now = Date.now()
  for (const cert of certs) {
    const validTo = cert.valid_to ? cert.valid_to.getTime() : Infinity
    const validFrom = cert.valid_from ? cert.valid_from.getTime() : 0
    if (cert.status === 'valid' && now >= validFrom && now <= validTo) {
      validCertStates.set(cert.id, cert.state)
    }
  }

  const certByVendorState = new Map<string, true>()
  const certByCategoryState = new Map<string, true>()
  for (const cov of coverage) {
    const state = validCertStates.get(cov.certificate_id)
    if (!state) continue
    if (cov.vendor_id) certByVendorState.set(`${cov.vendor_id}|${state}`, true)
    if (cov.category_id) certByCategoryState.set(`${cov.category_id}|${state}`, true)
  }

  const statuteByState = new Map<string, typeof statute_rules.$inferSelect>()
  for (const s of statutes) statuteByState.set(s.state, s)

  return {
    jurisdictionsByCode,
    ratesByJurisdiction,
    taxabilityByCatState,
    certByVendorState,
    certByCategoryState,
    statuteByState,
  }
}

function pickJurisdiction(
  ctx: AuditContext,
  inv: typeof invoices.$inferSelect,
  line: typeof invoice_lines.$inferSelect,
): { jur: typeof jurisdictions.$inferSelect | null; key: string | null } {
  if (line.jurisdiction_charged && ctx.jurisdictionsByCode.has(line.jurisdiction_charged)) {
    return { jur: ctx.jurisdictionsByCode.get(line.jurisdiction_charged)!, key: line.jurisdiction_charged }
  }
  if (inv.ship_to_state) {
    for (const [code, j] of ctx.jurisdictionsByCode) {
      if (
        j.state === inv.ship_to_state &&
        (!inv.ship_to_county || !j.county || j.county === inv.ship_to_county) &&
        (!inv.ship_to_city || !j.city || j.city === inv.ship_to_city)
      ) {
        return { jur: j, key: code }
      }
    }
  }
  return { jur: null, key: line.jurisdiction_charged ?? null }
}

function auditLine(
  ctx: AuditContext,
  inv: typeof invoices.$inferSelect,
  line: typeof invoice_lines.$inferSelect,
): LineFinding | null {
  const trace: Array<{ step: string; detail: string }> = []
  const taxCharged = line.tax_cents ?? 0
  const amount = line.amount_cents ?? 0
  const state = inv.ship_to_state ?? null

  const { jur, key: jurKey } = pickJurisdiction(ctx, inv, line)
  trace.push({
    step: 'jurisdiction',
    detail: jur ? `matched ${jur.code} (${jur.state})` : 'no jurisdiction matched',
  })

  if (state) {
    const vendorKey = inv.vendor_id ? `${inv.vendor_id}|${state}` : ''
    const catKey = line.category_id ? `${line.category_id}|${state}` : ''
    const covered =
      (vendorKey && ctx.certByVendorState.has(vendorKey)) ||
      (catKey && ctx.certByCategoryState.has(catKey))
    if (covered && taxCharged > 0) {
      trace.push({ step: 'exemption', detail: `valid exemption certificate covers this line in ${state}` })
      return {
        type: 'exemption_not_applied',
        jurisdiction: jurKey,
        recoverable_cents: taxCharged,
        reason: `Vendor charged ${taxCharged}c tax despite a valid exemption certificate covering this vendor/category in ${state}`,
        confidence: 0.95,
        audit_result: 'overcharged',
        trace,
      }
    }
  }

  if (line.category_id && state) {
    const rule = ctx.taxabilityByCatState.get(`${line.category_id}|${state}`)
    if (rule) {
      trace.push({ step: 'taxability', detail: `category rule in ${state}: ${rule.taxability}` })
      if (rule.taxability === 'exempt' || rule.taxability === 'nontaxable') {
        if (taxCharged > 0) {
          return {
            type: 'exempt_item_taxed',
            jurisdiction: jurKey,
            recoverable_cents: taxCharged,
            reason: `Category is ${rule.taxability} in ${state}; vendor charged ${taxCharged}c tax`,
            confidence: 0.9,
            audit_result: 'overcharged',
            trace,
          }
        }
      } else if (rule.taxability === 'reduced' && rule.reduced_rate != null && jur) {
        const expected = Math.round(amount * rule.reduced_rate)
        if (taxCharged > expected) {
          const recoverable = taxCharged - expected
          trace.push({
            step: 'reduced_rate',
            detail: `expected reduced rate ${rule.reduced_rate} (≈${expected}c); charged ${taxCharged}c`,
          })
          return {
            type: 'reduced_rate_not_applied',
            jurisdiction: jurKey,
            recoverable_cents: recoverable,
            reason: `Category qualifies for reduced rate ${rule.reduced_rate} in ${state}; overcharged ${recoverable}c`,
            confidence: 0.8,
            audit_result: 'overcharged',
            trace,
          }
        }
      }
    }
  }

  if (jur && taxCharged > 0 && amount > 0) {
    const rate = ctx.ratesByJurisdiction.get(jur.id)
    if (rate) {
      const expectedTax = Math.round(amount * rate.combined_rate)
      const chargedRate = line.rate_charged ?? taxCharged / amount
      trace.push({
        step: 'rate',
        detail: `combined_rate=${rate.combined_rate}, expectedTax≈${expectedTax}c, chargedRate=${chargedRate}`,
      })
      if (taxCharged > expectedTax + 1) {
        const recoverable = taxCharged - expectedTax
        return {
          type: 'rate_overcharge',
          jurisdiction: jurKey,
          recoverable_cents: recoverable,
          reason: `Charged ${taxCharged}c vs expected ${expectedTax}c at combined rate ${rate.combined_rate} for ${jur.code}; overcharged ${recoverable}c`,
          confidence: 0.85,
          audit_result: 'overcharged',
          trace,
        }
      }
    }
  }

  return null
}

function statuteDeadline(
  ctx: AuditContext,
  state: string | null,
  transactionDate: Date | null,
): Date | null {
  if (!state || !transactionDate) return null
  const rule = ctx.statuteByState.get(state)
  const months = rule?.window_months ?? 36
  const d = new Date(transactionDate)
  d.setMonth(d.getMonth() + months)
  return d
}

// ---------------------------------------------------------------------------
// GET / — public — findings ledger (?workspace_id&type&status)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
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
    .where(and(...conditions))
    .orderBy(desc(findings.recoverable_cents))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — public — finding detail
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [f] = await db.select().from(findings).where(eq(findings.id, id))
  if (!f) return c.json({ error: 'Not found' }, 404)
  return c.json(f)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth — update finding (status transition, write-off)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  status: z.enum(FINDING_STATUSES).optional(),
  recoverable_cents: z.number().int().min(0).optional(),
  reason: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(findings).where(eq(findings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')
  if (Object.keys(body).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  const [updated] = await db
    .update(findings)
    .set({ ...body, updated_at: new Date() })
    .where(eq(findings.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /:id/reaudit — auth — re-evaluate a single finding against current rules
// ---------------------------------------------------------------------------

router.post('/:id/reaudit', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(findings).where(eq(findings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (!existing.invoice_id || !existing.invoice_line_id) {
    return c.json({ error: 'Finding is not linked to an invoice line' }, 400)
  }

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, existing.invoice_id))
  const [line] = await db
    .select()
    .from(invoice_lines)
    .where(eq(invoice_lines.id, existing.invoice_line_id))
  if (!inv || !line) {
    return c.json({ error: 'Linked invoice or line no longer exists' }, 404)
  }

  const ctx = await buildContext(existing.workspace_id)
  const result = auditLine(ctx, inv, line)

  if (!result) {
    // No overcharge under current rules → resolve the line and dismiss the finding.
    await db
      .update(invoice_lines)
      .set({
        audit_result: 'clean',
        audit_reason: 'Re-audit found no overcharge',
        recoverable_cents: 0,
      })
      .where(eq(invoice_lines.id, line.id))

    const [updated] = await db
      .update(findings)
      .set({
        type: 'no_finding',
        recoverable_cents: 0,
        reason: 'Re-audit found no overcharge under current rules',
        confidence: 1,
        status: 'dismissed',
        updated_at: new Date(),
      })
      .where(eq(findings.id, id))
      .returning()
    return c.json(updated)
  }

  // Persist refreshed line audit result.
  await db
    .update(invoice_lines)
    .set({
      audit_result: result.audit_result,
      audit_reason: result.reason,
      recoverable_cents: result.recoverable_cents,
      audit_trace: result.trace,
    })
    .where(eq(invoice_lines.id, line.id))

  const deadline = statuteDeadline(ctx, inv.ship_to_state, inv.invoice_date)
  const [updated] = await db
    .update(findings)
    .set({
      type: result.type,
      jurisdiction: result.jurisdiction,
      recoverable_cents: result.recoverable_cents,
      reason: result.reason,
      confidence: result.confidence,
      transaction_date: inv.invoice_date,
      statute_deadline: deadline,
      updated_at: new Date(),
    })
    .where(eq(findings.id, id))
    .returning()
  return c.json(updated)
})

export default router
