import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { taxability_rules, product_categories, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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
  category_id: z.string().min(1),
  state: z.string().min(1),
  taxability: z.enum(['taxable', 'exempt', 'reduced', 'unknown']).optional().default('taxable'),
  reduced_rate: z.number().optional(),
  note: z.string().optional(),
})

const updateSchema = z.object({
  state: z.string().min(1).optional(),
  taxability: z.enum(['taxable', 'exempt', 'reduced', 'unknown']).optional(),
  reduced_rate: z.number().nullable().optional(),
  note: z.string().optional(),
})

// Public: list taxability rules by workspace_id or category_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const categoryId = c.req.query('category_id')
  if (!workspaceId && !categoryId) {
    return c.json({ error: 'workspace_id or category_id is required' }, 400)
  }
  const conds = []
  if (workspaceId) conds.push(eq(taxability_rules.workspace_id, workspaceId))
  if (categoryId) conds.push(eq(taxability_rules.category_id, categoryId))
  const rows = await db
    .select()
    .from(taxability_rules)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(taxability_rules.created_at))
  return c.json(rows)
})

// Auth: create rule (keyed by category + state, UNIQUE(category_id, state))
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Verify category belongs to the same workspace.
  const [cat] = await db
    .select()
    .from(product_categories)
    .where(eq(product_categories.id, body.category_id))
  if (!cat) return c.json({ error: 'Category not found' }, 404)
  if (cat.workspace_id !== body.workspace_id) {
    return c.json({ error: 'Category does not belong to workspace' }, 400)
  }
  // Upsert on the (category_id, state) unique key so a repeat write updates in place.
  const [row] = await db
    .insert(taxability_rules)
    .values({
      workspace_id: body.workspace_id,
      category_id: body.category_id,
      state: body.state,
      taxability: body.taxability,
      reduced_rate: body.reduced_rate ?? null,
      note: body.note ?? null,
    })
    .onConflictDoUpdate({
      target: [taxability_rules.category_id, taxability_rules.state],
      set: {
        taxability: body.taxability,
        reduced_rate: body.reduced_rate ?? null,
        note: body.note ?? null,
      },
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update rule
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(taxability_rules).where(eq(taxability_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(taxability_rules)
    .set(body)
    .where(eq(taxability_rules.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete rule
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(taxability_rules).where(eq(taxability_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(taxability_rules).where(eq(taxability_rules.id, id))
  return c.json({ success: true })
})

export default router
