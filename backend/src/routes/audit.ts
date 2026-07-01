import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  audit_runs,
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
import { eq, and, desc, ne } from 'drizzle-orm'
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

interface AuditContext {
  jurisdictionsByCode: Map<string, typeof jurisdictions.$inferSelect>
  ratesByJurisdiction: Map<string, typeof jurisdiction_rates.$inferSelect>
  taxabilityByCatState: Map<string, typeof taxability_rules.$inferSelect>
  certCoverage: {
    certByVendorState: Map<string, true>
    certByCategoryState: Map<string, true>
  }
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

function pickJurisdiction(
  ctx: AuditContext,
  inv: typeof invoices.$inferSelect,
  line: typeof invoice_lines.$inferSelect,
): { jur: typeof jurisdictions.$inferSelect | null; key: string | null } {
  // Prefer the jurisdiction charged on the line, then match by ship-to state.
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

// Evaluate one invoice line; returns a finding (or null when no overcharge).
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

  // 1. Exemption certificate coverage — if covered, ALL charged tax is recoverable.
  if (state) {
    const vendorKey = inv.vendor_id ? `${inv.vendor_id}|${state}` : ''
    const catKey = line.category_id ? `${line.category_id}|${state}` : ''
    const covered =
      (vendorKey && ctx.certCoverage.certByVendorState.has(vendorKey)) ||
      (catKey && ctx.certCoverage.certByCategoryState.has(catKey))
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

  // 2. Taxability — if the category is exempt/non-taxable in this state, tax is recoverable.
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
        // Reduced-rate item taxed at full rate.
        const rate = ctx.ratesByJurisdiction.get(jur.id)
        const fullRate = rate?.combined_rate ?? 0
        const expected = Math.round(amount * rule.reduced_rate)
        if (taxCharged > expected) {
          const recoverable = taxCharged - expected
          trace.push({
            step: 'reduced_rate',
            detail: `expected reduced rate ${rule.reduced_rate} (≈${expected}c) vs full ${fullRate}; charged ${taxCharged}c`,
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

  // 3. Rate audit — compare charged rate against the jurisdiction's combined rate.
  if (jur && taxCharged > 0 && amount > 0) {
    const rate = ctx.ratesByJurisdiction.get(jur.id)
    if (rate) {
      const expectedTax = Math.round(amount * rate.combined_rate)
      const chargedRate = line.rate_charged ?? taxCharged / amount
      trace.push({
        step: 'rate',
        detail: `combined_rate=${rate.combined_rate}, expectedTax≈${expectedTax}c, chargedRate=${chargedRate}`,
      })
      // Tolerate 1 cent rounding noise.
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

  // Latest rate per jurisdiction (rows are ordered by created_at desc on insert; pick first seen).
  const ratesByJurisdiction = new Map<string, typeof jurisdiction_rates.$inferSelect>()
  const sortedRates = [...rates].sort(
    (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
  )
  for (const r of sortedRates) {
    if (!ratesByJurisdiction.has(r.jurisdiction_id)) ratesByJurisdiction.set(r.jurisdiction_id, r)
  }

  const taxabilityByCatState = new Map<string, typeof taxability_rules.$inferSelect>()
  for (const r of rules) taxabilityByCatState.set(`${r.category_id}|${r.state}`, r)

  const validCertStates = new Map<string, string>() // certId -> state (only valid certs)
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
    certCoverage: { certByVendorState, certByCategoryState },
    statuteByState,
  }
}

// ---------------------------------------------------------------------------
// GET /runs — public — audit-run history (?workspace_id)
// ---------------------------------------------------------------------------

router.get('/runs', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(audit_runs)
    .where(eq(audit_runs.workspace_id, workspaceId))
    .orderBy(desc(audit_runs.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /runs/:id — public — run detail
// ---------------------------------------------------------------------------

router.get('/runs/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(audit_runs).where(eq(audit_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  return c.json(run)
})

// ---------------------------------------------------------------------------
// POST /run — auth — run a full taxability + rate audit
// ---------------------------------------------------------------------------

const runSchema = z.object({
  workspace_id: z.string().min(1),
  scope: z.string().min(1).optional().default('all'),
})

router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, scope } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const ctx = await buildContext(workspace_id)

  // Select invoices in scope. 'all'/'full' = every invoice; 'unaudited' = not yet
  // audited; 'recent' = most recently created; anything else is treated as a
  // literal invoice status filter.
  const invConditions = [eq(invoices.workspace_id, workspace_id)]
  if (scope === 'unaudited') {
    invConditions.push(ne(invoices.status, 'audited'))
  } else if (scope && scope !== 'all' && scope !== 'full' && scope !== 'recent') {
    invConditions.push(eq(invoices.status, scope))
  }
  let invs = await db
    .select()
    .from(invoices)
    .where(and(...invConditions))
    .orderBy(desc(invoices.created_at))
  if (scope === 'recent') invs = invs.slice(0, 20)

  // Create the run row up front so findings can reference it.
  const [run] = await db
    .insert(audit_runs)
    .values({
      workspace_id,
      scope: scope ?? 'all',
      lines_scanned: 0,
      findings_count: 0,
      total_recoverable_cents: 0,
      status: 'running',
      created_by: userId,
    })
    .returning()

  let linesScanned = 0
  let findingsCount = 0
  let totalRecoverable = 0

  for (const inv of invs) {
    const lines = await db
      .select()
      .from(invoice_lines)
      .where(eq(invoice_lines.invoice_id, inv.id))

    for (const line of lines) {
      linesScanned++
      const result = auditLine(ctx, inv, line)

      if (result) {
        findingsCount++
        totalRecoverable += result.recoverable_cents

        // Persist line audit result.
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
        await db.insert(findings).values({
          workspace_id,
          audit_run_id: run.id,
          invoice_id: inv.id,
          invoice_line_id: line.id,
          vendor_id: inv.vendor_id ?? null,
          type: result.type,
          jurisdiction: result.jurisdiction,
          recoverable_cents: result.recoverable_cents,
          reason: result.reason,
          confidence: result.confidence,
          status: 'identified',
          transaction_date: inv.invoice_date,
          statute_deadline: deadline,
        })
      } else {
        await db
          .update(invoice_lines)
          .set({
            audit_result: 'clean',
            audit_reason: 'No overcharge detected',
            recoverable_cents: 0,
          })
          .where(eq(invoice_lines.id, line.id))
      }
    }

    // Mark the invoice as audited.
    await db.update(invoices).set({ status: 'audited' }).where(eq(invoices.id, inv.id))
  }

  const [finished] = await db
    .update(audit_runs)
    .set({
      lines_scanned: linesScanned,
      findings_count: findingsCount,
      total_recoverable_cents: totalRecoverable,
      status: 'completed',
    })
    .where(eq(audit_runs.id, run.id))
    .returning()

  return c.json({
    run: finished,
    findings_count: findingsCount,
    total_recoverable_cents: totalRecoverable,
  })
})

export default router
