import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views } from '../db/schema.js'
import { and, eq, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  entity: z.string().min(1),
  filters: z.record(z.unknown()).optional().default({}),
  is_default: z.boolean().optional().default(false),
})

// GET / — saved views for the current user (?workspace_id&entity) — auth
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  const entity = c.req.query('entity')

  const conditions = [eq(saved_views.user_id, userId)]
  if (workspaceId) conditions.push(eq(saved_views.workspace_id, workspaceId))
  if (entity) conditions.push(eq(saved_views.entity, entity))

  const rows = await db
    .select()
    .from(saved_views)
    .where(and(...conditions))
    .orderBy(desc(saved_views.created_at))

  return c.json(rows)
})

// POST / — create a saved view — auth
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If this view is marked default, clear the previous default for the same user/workspace/entity.
  if (body.is_default) {
    await db
      .update(saved_views)
      .set({ is_default: false })
      .where(
        and(
          eq(saved_views.user_id, userId),
          eq(saved_views.workspace_id, body.workspace_id),
          eq(saved_views.entity, body.entity),
          eq(saved_views.is_default, true),
        ),
      )
  }

  const [created] = await db
    .insert(saved_views)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      entity: body.entity,
      filters: body.filters,
      is_default: body.is_default,
    })
    .returning()

  return c.json(created, 201)
})

// DELETE /:id — delete a saved view — auth (ownership checked)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(saved_views).where(eq(saved_views.id, id))
  return c.json({ success: true })
})

export default router
