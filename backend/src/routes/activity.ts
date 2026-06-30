import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — immutable activity / audit-trail log read.
// Filters: ?workspace_id (required for any rows), &entity_type, &entity_id.
// Public read. The log is append-only; this file exposes no write endpoint.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json([])

  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')

  const conditions = [eq(activity_log.workspace_id, workspaceId)]
  if (entityType) conditions.push(eq(activity_log.entity_type, entityType))
  if (entityId) conditions.push(eq(activity_log.entity_id, entityId))

  const rows = await db
    .select()
    .from(activity_log)
    .where(and(...conditions))
    .orderBy(desc(activity_log.created_at))
    .limit(500)

  return c.json(rows)
})

export default router
