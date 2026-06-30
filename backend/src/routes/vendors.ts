import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { vendors, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const vendorSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  dba: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  default_state: z.string().optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  default_taxability: z.string().optional().default('unknown'),
  risk_score: z.number().optional().default(0),
  aliases: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
})

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// GET / — public — list vendors (?workspace_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.workspace_id, workspaceId))
    .orderBy(desc(vendors.created_at))
  return c.json(rows)
})

// GET /:id — public — vendor detail
router.get('/:id', async (c) => {
  const [v] = await db.select().from(vendors).where(eq(vendors.id, c.req.param('id')))
  if (!v) return c.json({ error: 'Not found' }, 404)
  return c.json(v)
})

// POST / — auth — create vendor
router.post('/', authMiddleware, zValidator('json', vendorSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [v] = await db
    .insert(vendors)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      dba: body.dba ?? null,
      tax_id: body.tax_id ?? null,
      default_state: body.default_state ?? null,
      contact_email: body.contact_email ?? null,
      contact_name: body.contact_name ?? null,
      default_taxability: body.default_taxability,
      risk_score: body.risk_score,
      aliases: body.aliases,
      notes: body.notes ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(v, 201)
})

// PUT /:id — auth — update vendor
router.put('/:id', authMiddleware, zValidator('json', vendorSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(vendors).where(eq(vendors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  // workspace_id is immutable on update
  const { workspace_id: _ignore, ...rest } = body
  const [updated] = await db.update(vendors).set(rest).where(eq(vendors.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete vendor
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(vendors).where(eq(vendors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(vendors).where(eq(vendors.id, id))
  return c.json({ success: true })
})

export default router
