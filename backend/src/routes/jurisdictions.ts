import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { jurisdictions, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  code: z.string().min(1),
  state: z.string().min(1),
  county: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  freight_taxable: z.boolean().optional(),
  labor_taxable: z.boolean().optional(),
  saas_taxable: z.boolean().optional(),
})

const updateSchema = createSchema.partial().omit({ workspace_id: true })

// Public: lookup by ?state&county&city — MUST be declared before '/:id'
router.get('/lookup', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const state = c.req.query('state')
  const county = c.req.query('county')
  const city = c.req.query('city')
  if (!state) return c.json({ error: 'state is required' }, 400)

  const conds = [eq(jurisdictions.state, state)]
  if (workspaceId) conds.push(eq(jurisdictions.workspace_id, workspaceId))
  if (county) conds.push(eq(jurisdictions.county, county))
  if (city) conds.push(eq(jurisdictions.city, city))

  const matches = await db
    .select()
    .from(jurisdictions)
    .where(and(...conds))
    .orderBy(asc(jurisdictions.code))

  // Prefer the most specific match (city+county), then fall back.
  const ranked = matches.sort((a, b) => {
    const score = (j: typeof matches[number]) => (j.city ? 2 : 0) + (j.county ? 1 : 0)
    return score(b) - score(a)
  })

  return c.json(ranked[0] ?? null)
})

// Public: list jurisdictions (?workspace_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.workspace_id, workspaceId))
    .orderBy(asc(jurisdictions.code))
  return c.json(rows)
})

// Public: jurisdiction detail
router.get('/:id', async (c) => {
  const [j] = await db.select().from(jurisdictions).where(eq(jurisdictions.id, c.req.param('id')))
  if (!j) return c.json({ error: 'Not found' }, 404)
  return c.json(j)
})

// Auth: create jurisdiction
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db.insert(jurisdictions).values(body).returning()
  return c.json(created, 201)
})

// Auth: update jurisdiction
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(jurisdictions).where(eq(jurisdictions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(jurisdictions).set(body).where(eq(jurisdictions.id, id)).returning()
  return c.json(updated)
})

export default router
