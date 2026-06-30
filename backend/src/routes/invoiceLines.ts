import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { invoice_lines, invoices, workspace_members, product_categories } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const updateLineSchema = z.object({
  category_id: z.string().nullable().optional(),
  description: z.string().optional(),
  gl_account: z.string().nullable().optional(),
  amount_cents: z.number().int().optional(),
  tax_cents: z.number().int().optional(),
  rate_charged: z.number().optional(),
  jurisdiction_charged: z.string().nullable().optional(),
  audit_result: z.string().optional(),
  audit_reason: z.string().nullable().optional(),
  recoverable_cents: z.number().int().optional(),
})

// Public: lines for an invoice (?invoice_id)
router.get('/', async (c) => {
  const invoiceId = c.req.query('invoice_id')
  if (!invoiceId) return c.json({ error: 'invoice_id is required' }, 400)
  const lines = await db
    .select()
    .from(invoice_lines)
    .where(eq(invoice_lines.invoice_id, invoiceId))
    .orderBy(asc(invoice_lines.line_number))
  return c.json(lines)
})

// Auth: update a line (category / taxability override)
router.put('/:id', authMiddleware, zValidator('json', updateLineSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(invoice_lines).where(eq(invoice_lines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // If a category is being set, verify it belongs to the same workspace.
  if (body.category_id) {
    const [cat] = await db
      .select()
      .from(product_categories)
      .where(eq(product_categories.id, body.category_id))
    if (!cat) return c.json({ error: 'Category not found' }, 400)
    if (cat.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'Category belongs to a different workspace' }, 400)
    }
  }

  const [updated] = await db
    .update(invoice_lines)
    .set(body)
    .where(eq(invoice_lines.id, id))
    .returning()

  // Keep parent invoice tax/subtotal aggregates consistent if amounts changed.
  if (body.amount_cents !== undefined || body.tax_cents !== undefined) {
    const siblings = await db
      .select()
      .from(invoice_lines)
      .where(eq(invoice_lines.invoice_id, existing.invoice_id))
    const subtotal = siblings.reduce((s, l) => s + (l.amount_cents ?? 0), 0)
    const tax = siblings.reduce((s, l) => s + (l.tax_cents ?? 0), 0)
    await db
      .update(invoices)
      .set({ subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax })
      .where(eq(invoices.id, existing.invoice_id))
  }

  return c.json(updated)
})

export default router
