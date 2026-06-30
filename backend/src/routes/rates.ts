import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { jurisdiction_rates, jurisdictions, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Sum the components into combined_rate unless an explicit value is supplied.
function withCombined<T extends {
  state_rate?: number
  county_rate?: number
  city_rate?: number
  district_rate?: number
  combined_rate?: number
}>(body: T): T {
  if (body.combined_rate !== undefined && body.combined_rate !== null) return body
  const parts = [body.state_rate, body.county_rate, body.city_rate, body.district_rate]
  if (parts.every((p) => p === undefined)) return body
  const combined = parts.reduce<number>((s, p) => s + (p ?? 0), 0)
  return { ...body, combined_rate: combined }
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  jurisdiction_id: z.string().min(1),
  state_rate: z.number().optional(),
  county_rate: z.number().optional(),
  city_rate: z.number().optional(),
  district_rate: z.number().optional(),
  combined_rate: z.number().optional(),
  effective_from: z.string().datetime().nullable().optional(),
  effective_to: z.string().datetime().nullable().optional(),
})

const updateSchema = createSchema.partial().omit({ workspace_id: true, jurisdiction_id: true })

// Public: list rates (?jurisdiction_id), newest effective range first
router.get('/', async (c) => {
  const jurisdictionId = c.req.query('jurisdiction_id')
  if (!jurisdictionId) return c.json({ error: 'jurisdiction_id is required' }, 400)
  const rows = await db
    .select()
    .from(jurisdiction_rates)
    .where(eq(jurisdiction_rates.jurisdiction_id, jurisdictionId))
    .orderBy(desc(jurisdiction_rates.effective_from))
  return c.json(rows)
})

// Auth: create rate
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [jur] = await db.select().from(jurisdictions).where(eq(jurisdictions.id, body.jurisdiction_id))
  if (!jur) return c.json({ error: 'Jurisdiction not found' }, 400)
  if (jur.workspace_id !== body.workspace_id) {
    return c.json({ error: 'Jurisdiction belongs to a different workspace' }, 400)
  }

  const values = withCombined({
    ...body,
    effective_from: body.effective_from ? new Date(body.effective_from) : undefined,
    effective_to: body.effective_to ? new Date(body.effective_to) : undefined,
  })

  const [created] = await db.insert(jurisdiction_rates).values(values as any).returning()
  return c.json(created, 201)
})

// Auth: update rate
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(jurisdiction_rates).where(eq(jurisdiction_rates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const merged = withCombined({
    state_rate: body.state_rate ?? existing.state_rate,
    county_rate: body.county_rate ?? existing.county_rate,
    city_rate: body.city_rate ?? existing.city_rate,
    district_rate: body.district_rate ?? existing.district_rate,
    combined_rate: body.combined_rate,
  })

  const setValues: Record<string, unknown> = { ...merged }
  if (body.effective_from !== undefined) {
    setValues.effective_from = body.effective_from ? new Date(body.effective_from) : null
  }
  if (body.effective_to !== undefined) {
    setValues.effective_to = body.effective_to ? new Date(body.effective_to) : null
  }

  const [updated] = await db
    .update(jurisdiction_rates)
    .set(setValues)
    .where(eq(jurisdiction_rates.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete rate
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(jurisdiction_rates).where(eq(jurisdiction_rates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(jurisdiction_rates).where(eq(jurisdiction_rates.id, id))
  return c.json({ success: true })
})

export default router
