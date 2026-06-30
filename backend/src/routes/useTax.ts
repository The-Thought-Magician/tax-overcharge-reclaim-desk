import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { use_tax_entries, invoices, workspace_members } from '../db/schema.js'
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

const createSchema = z.object({
  workspace_id: z.string().min(1),
  vendor_id: z.string().min(1).optional().nullable(),
  invoice_id: z.string().min(1).optional().nullable(),
  period: z.string().min(1).optional().nullable(),
  accrued_cents: z.number().int().min(0).optional().default(0),
  matched: z.boolean().optional(),
  double_paid: z.boolean().optional(),
  note: z.string().optional().nullable(),
})

const updateSchema = z.object({
  vendor_id: z.string().min(1).optional().nullable(),
  invoice_id: z.string().min(1).optional().nullable(),
  period: z.string().min(1).optional().nullable(),
  accrued_cents: z.number().int().min(0).optional(),
  matched: z.boolean().optional(),
  double_paid: z.boolean().optional(),
  note: z.string().optional().nullable(),
})

const reconcileSchema = z.object({
  workspace_id: z.string().min(1),
  period: z.string().min(1).optional().nullable(),
})

// ---------------------------------------------------------------------------
// GET / — public — list use-tax entries (?workspace_id&period)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const period = c.req.query('period')

  const conditions = [eq(use_tax_entries.workspace_id, workspaceId)]
  if (period) conditions.push(eq(use_tax_entries.period, period))

  const rows = await db
    .select()
    .from(use_tax_entries)
    .where(and(...conditions))
    .orderBy(desc(use_tax_entries.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — create entry
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Validate referenced invoice belongs to the same workspace, if provided.
  if (body.invoice_id) {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, body.invoice_id))
    if (!inv || inv.workspace_id !== body.workspace_id) {
      return c.json({ error: 'invoice_id does not belong to this workspace' }, 400)
    }
  }

  const [created] = await db
    .insert(use_tax_entries)
    .values({
      workspace_id: body.workspace_id,
      vendor_id: body.vendor_id ?? null,
      invoice_id: body.invoice_id ?? null,
      period: body.period ?? null,
      accrued_cents: body.accrued_cents ?? 0,
      matched: body.matched ?? false,
      double_paid: body.double_paid ?? false,
      note: body.note ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth — update entry
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(use_tax_entries).where(eq(use_tax_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')
  if (body.invoice_id) {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, body.invoice_id))
    if (!inv || inv.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'invoice_id does not belong to this workspace' }, 400)
    }
  }

  const [updated] = await db
    .update(use_tax_entries)
    .set(body)
    .where(eq(use_tax_entries.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /reconcile — auth — flag double-paid entries
//
// For each use-tax entry we self-assessed/accrued, check whether the linked
// invoice was ALSO charged tax by the vendor (invoices.tax_cents > 0). If so
// the same transaction has been taxed twice (vendor-charged + self-accrued):
// flag double_paid. Entries whose invoice carried no vendor tax and that have
// an accrual are marked matched (correctly self-assessed). Entries with no
// linked invoice are left untouched.
// ---------------------------------------------------------------------------

router.post('/reconcile', authMiddleware, zValidator('json', reconcileSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, period } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const conditions = [eq(use_tax_entries.workspace_id, workspace_id)]
  if (period) conditions.push(eq(use_tax_entries.period, period))
  const entries = await db
    .select()
    .from(use_tax_entries)
    .where(and(...conditions))

  // Build an invoice tax lookup for the referenced invoices.
  const invoiceIds = [...new Set(entries.map((e) => e.invoice_id).filter((x): x is string => !!x))]
  const invoiceTax = new Map<string, number>()
  for (const invId of invoiceIds) {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invId))
    if (inv) invoiceTax.set(invId, inv.tax_cents ?? 0)
  }

  let matchedCount = 0
  let doublePaidCount = 0
  const updatedEntries = []

  for (const entry of entries) {
    let matched = entry.matched
    let doublePaid = entry.double_paid

    if (entry.invoice_id) {
      const vendorTax = invoiceTax.get(entry.invoice_id) ?? 0
      if (vendorTax > 0 && (entry.accrued_cents ?? 0) > 0) {
        // Vendor charged tax AND we accrued use-tax → double payment.
        doublePaid = true
        matched = false
        doublePaidCount++
      } else if ((entry.accrued_cents ?? 0) > 0) {
        // We accrued, vendor did not charge → correctly self-assessed.
        matched = true
        doublePaid = false
        matchedCount++
      } else {
        matched = false
        doublePaid = false
      }
    }

    if (matched !== entry.matched || doublePaid !== entry.double_paid) {
      const [u] = await db
        .update(use_tax_entries)
        .set({ matched, double_paid: doublePaid })
        .where(eq(use_tax_entries.id, entry.id))
        .returning()
      updatedEntries.push(u)
    } else {
      updatedEntries.push(entry)
    }
  }

  return c.json({
    matched: matchedCount,
    double_paid: doublePaidCount,
    entries: updatedEntries,
  })
})

export default router
