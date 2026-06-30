import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const shipToSchema = z.object({
  line1: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
}).partial()

const permitSchema = z.object({
  state: z.string(),
  type: z.string(),
  number: z.string(),
})

const workspaceSchema = z.object({
  name: z.string().min(1),
  legal_entity: z.string().optional().nullable(),
  nexus_states: z.array(z.string()).optional().default([]),
  permits: z.array(permitSchema).optional().default([]),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional().default(1),
  default_ship_to: shipToSchema.optional().default({}),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().min(1).optional().default('manager'),
})

// Helper: is the user a member of the workspace?
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// GET / — list workspaces the user is a member of
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const ids = memberships.map((m) => m.workspace_id)
  if (ids.length === 0) return c.json([])
  const rows = await db.select().from(workspaces).where(inArray(workspaces.id, ids))
  return c.json(rows)
})

// GET /:id — get one workspace (membership checked)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!(await isMember(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// POST / — create workspace + owner membership
router.post('/', authMiddleware, zValidator('json', workspaceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      legal_entity: body.legal_entity ?? null,
      nexus_states: body.nexus_states,
      permits: body.permits,
      fiscal_year_start_month: body.fiscal_year_start_month,
      default_ship_to: body.default_ship_to,
      created_by: userId,
    })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })
  return c.json(ws, 201)
})

// PUT /:id — update workspace (membership checked)
router.put('/:id', authMiddleware, zValidator('json', workspaceSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!(await isMember(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db.update(workspaces).set(body).where(eq(workspaces.id, id)).returning()
  return c.json(updated)
})

// GET /:id/members — list members (membership checked)
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!(await isMember(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
  return c.json(rows)
})

// POST /:id/members — add member {user_id, role}
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!(await isMember(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.user_id, body.user_id)))
  if (existing) return c.json({ error: 'Member already exists' }, 409)
  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(member, 201)
})

export default router
