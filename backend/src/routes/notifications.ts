import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { and, eq, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const readAllSchema = z.object({
  workspace_id: z.string().min(1),
})

// GET / — current user's notifications (?workspace_id) — auth
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')

  const conditions = [eq(notifications.user_id, userId)]
  if (workspaceId) conditions.push(eq(notifications.workspace_id, workspaceId))

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.created_at))

  return c.json(rows)
})

// POST /:id/read — mark a single notification read — auth (ownership checked)
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()

  return c.json(updated)
})

// POST /read-all — mark all of the user's notifications read in a workspace — auth
router.post('/read-all', authMiddleware, zValidator('json', readAllSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.workspace_id, workspace_id),
        eq(notifications.read, false),
      ),
    )
    .returning()

  return c.json({ updated: updated.length })
})

export default router
