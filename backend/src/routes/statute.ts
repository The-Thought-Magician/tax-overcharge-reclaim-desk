import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { statute_rules, findings } from '../db/schema.js'
import { eq, and, lte, gte, isNotNull, ne, asc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ruleSchema = z.object({
  workspace_id: z.string().min(1),
  state: z.string().min(1),
  window_months: z.number().int().positive().optional().default(36),
  basis: z.string().min(1).optional().default('transaction'),
  note: z.string().optional().nullable(),
})

// Public: list SOL rules for a workspace
router.get('/rules', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(statute_rules)
    .where(eq(statute_rules.workspace_id, workspaceId))
    .orderBy(asc(statute_rules.state))
  return c.json(rows)
})

// Auth: create or update a SOL rule (upsert by workspace_id + state)
router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const body = c.req.valid('json')
  const [rule] = await db
    .insert(statute_rules)
    .values({
      workspace_id: body.workspace_id,
      state: body.state,
      window_months: body.window_months,
      basis: body.basis,
      note: body.note ?? null,
    })
    .onConflictDoUpdate({
      target: [statute_rules.workspace_id, statute_rules.state],
      set: {
        window_months: body.window_months,
        basis: body.basis,
        note: body.note ?? null,
      },
    })
    .returning()
  return c.json(rule, 201)
})

// Public: findings nearing the statute deadline within ?days (default 90)
router.get('/expiring', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const days = parseInt(c.req.query('days') ?? '90', 10)
  const horizon = Number.isFinite(days) && days > 0 ? days : 90
  const now = new Date()
  const cutoff = new Date(now.getTime() + horizon * 86_400_000)

  const rows = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.workspace_id, workspaceId),
        isNotNull(findings.statute_deadline),
        lte(findings.statute_deadline, cutoff),
        gte(findings.statute_deadline, now),
        ne(findings.status, 'recovered'),
        ne(findings.status, 'written_off'),
      ),
    )
    .orderBy(asc(findings.statute_deadline))
  return c.json(rows)
})

export default router
