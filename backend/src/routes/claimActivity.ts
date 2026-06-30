import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { claim_activity, claims } from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  claim_id: z.string().min(1),
  action: z.string().min(1),
  detail: z.string().optional().nullable(),
})

// Public: activity for a claim (?claim_id)
router.get('/', async (c) => {
  const claimId = c.req.query('claim_id')
  if (!claimId) return c.json({ error: 'claim_id is required' }, 400)
  const rows = await db
    .select()
    .from(claim_activity)
    .where(eq(claim_activity.claim_id, claimId))
    .orderBy(desc(claim_activity.created_at))
  return c.json(rows)
})

// Auth: add an activity entry {claim_id, action, detail}
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [claim] = await db.select().from(claims).where(eq(claims.id, body.claim_id))
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const [entry] = await db
    .insert(claim_activity)
    .values({
      workspace_id: claim.workspace_id,
      claim_id: body.claim_id,
      action: body.action,
      detail: body.detail ?? null,
      user_id: userId,
    })
    .returning()

  return c.json(entry, 201)
})

export default router
