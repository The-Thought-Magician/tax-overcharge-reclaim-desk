import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { invoices, invoice_lines, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const lineInputSchema = z.object({
  line_number: z.number().int().optional().default(1),
  description: z.string().optional().nullable(),
  gl_account: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  amount_cents: z.number().int().optional().default(0),
  tax_cents: z.number().int().optional().default(0),
  rate_charged: z.number().optional().default(0),
  jurisdiction_charged: z.string().optional().nullable(),
})

const invoiceSchema = z.object({
  workspace_id: z.string().min(1),
  vendor_id: z.string().optional().nullable(),
  invoice_number: z.string().min(1),
  invoice_date: z.string().optional().nullable(),
  ship_to_state: z.string().optional().nullable(),
  ship_to_county: z.string().optional().nullable(),
  ship_to_city: z.string().optional().nullable(),
  ship_to_zip: z.string().optional().nullable(),
  subtotal_cents: z.number().int().optional().default(0),
  tax_cents: z.number().int().optional().default(0),
  total_cents: z.number().int().optional().default(0),
  status: z.string().optional().default('imported'),
  source: z.string().optional().default('manual'),
  lines: z.array(lineInputSchema).optional(),
})

const importSchema = z.object({
  workspace_id: z.string().min(1),
  invoices: z.array(invoiceSchema.omit({ workspace_id: true })).min(1),
})

const dupSchema = z.object({
  workspace_id: z.string().min(1),
})

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

function toDate(v?: string | null): Date | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

// GET / — public — list invoices (?workspace_id&status)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const conds = [eq(invoices.workspace_id, workspaceId)]
  if (status) conds.push(eq(invoices.status, status))
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conds))
    .orderBy(desc(invoices.created_at))
  return c.json(rows)
})

// GET /:id — public — invoice with lines
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!invoice) return c.json({ error: 'Not found' }, 404)
  const lines = await db
    .select()
    .from(invoice_lines)
    .where(eq(invoice_lines.invoice_id, id))
    .orderBy(invoice_lines.line_number)
  return c.json({ invoice, lines })
})

// POST / — auth — create invoice (+optional lines)
router.post('/', authMiddleware, zValidator('json', invoiceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const { lines, ...inv } = body
  const [invoice] = await db
    .insert(invoices)
    .values({
      workspace_id: inv.workspace_id,
      vendor_id: inv.vendor_id ?? null,
      invoice_number: inv.invoice_number,
      invoice_date: toDate(inv.invoice_date),
      ship_to_state: inv.ship_to_state ?? null,
      ship_to_county: inv.ship_to_county ?? null,
      ship_to_city: inv.ship_to_city ?? null,
      ship_to_zip: inv.ship_to_zip ?? null,
      subtotal_cents: inv.subtotal_cents,
      tax_cents: inv.tax_cents,
      total_cents: inv.total_cents,
      status: inv.status,
      source: inv.source,
      created_by: userId,
    })
    .returning()
  if (lines && lines.length > 0) {
    await db.insert(invoice_lines).values(
      lines.map((l) => ({
        workspace_id: inv.workspace_id,
        invoice_id: invoice.id,
        line_number: l.line_number,
        description: l.description ?? null,
        gl_account: l.gl_account ?? null,
        category_id: l.category_id ?? null,
        amount_cents: l.amount_cents,
        tax_cents: l.tax_cents,
        rate_charged: l.rate_charged,
        jurisdiction_charged: l.jurisdiction_charged ?? null,
      })),
    )
  }
  return c.json(invoice, 201)
})

// PUT /:id — auth — update invoice
router.put('/:id', authMiddleware, zValidator('json', invoiceSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const { lines: _lines, workspace_id: _ws, invoice_date, ...rest } = body
  const patch: Record<string, unknown> = { ...rest }
  if (invoice_date !== undefined) patch.invoice_date = toDate(invoice_date)
  const [updated] = await db.update(invoices).set(patch).where(eq(invoices.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete invoice + its lines
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(invoice_lines).where(eq(invoice_lines.invoice_id, id))
  await db.delete(invoices).where(eq(invoices.id, id))
  return c.json({ success: true })
})

// POST /import — auth — bulk import {workspace_id, invoices[]}
router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  let imported = 0
  for (const inv of body.invoices) {
    const { lines, ...row } = inv
    const [invoice] = await db
      .insert(invoices)
      .values({
        workspace_id: body.workspace_id,
        vendor_id: row.vendor_id ?? null,
        invoice_number: row.invoice_number,
        invoice_date: toDate(row.invoice_date),
        ship_to_state: row.ship_to_state ?? null,
        ship_to_county: row.ship_to_county ?? null,
        ship_to_city: row.ship_to_city ?? null,
        ship_to_zip: row.ship_to_zip ?? null,
        subtotal_cents: row.subtotal_cents,
        tax_cents: row.tax_cents,
        total_cents: row.total_cents,
        status: row.status,
        source: row.source ?? 'import',
        created_by: userId,
      })
      .returning()
    if (lines && lines.length > 0) {
      await db.insert(invoice_lines).values(
        lines.map((l) => ({
          workspace_id: body.workspace_id,
          invoice_id: invoice.id,
          line_number: l.line_number,
          description: l.description ?? null,
          gl_account: l.gl_account ?? null,
          category_id: l.category_id ?? null,
          amount_cents: l.amount_cents,
          tax_cents: l.tax_cents,
          rate_charged: l.rate_charged,
          jurisdiction_charged: l.jurisdiction_charged ?? null,
        })),
      )
    }
    imported++
  }
  return c.json({ imported }, 201)
})

// POST /check-duplicates — auth — duplicate detection {workspace_id}
router.post('/check-duplicates', authMiddleware, zValidator('json', dupSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.workspace_id, body.workspace_id))
    .orderBy(desc(invoices.created_at))

  // Group invoices by a duplicate key: vendor + invoice_number + total.
  const groups = new Map<string, typeof rows>()
  for (const inv of rows) {
    const key = `${inv.vendor_id ?? 'none'}|${(inv.invoice_number ?? '').trim().toLowerCase()}|${inv.total_cents}`
    const arr = groups.get(key)
    if (arr) arr.push(inv)
    else groups.set(key, [inv])
  }

  const duplicates = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      vendor_id: g[0].vendor_id,
      invoice_number: g[0].invoice_number,
      total_cents: g[0].total_cents,
      count: g.length,
      invoice_ids: g.map((i) => i.id),
      invoices: g,
    }))

  return c.json({ duplicates })
})

export default router
