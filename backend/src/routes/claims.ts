import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { claims, claim_findings, claim_activity, findings } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  vendor_id: z.string().optional().nullable(),
  claim_type: z.string().min(1).optional().default('vendor_credit'),
  jurisdiction: z.string().optional().nullable(),
  status: z.string().min(1).optional().default('draft'),
  expected_cents: z.number().int().optional().default(0),
  recovered_cents: z.number().int().optional().default(0),
  reference_number: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  finding_ids: z.array(z.string()).optional().default([]),
})

const updateSchema = z.object({
  vendor_id: z.string().optional().nullable(),
  claim_type: z.string().min(1).optional(),
  jurisdiction: z.string().optional().nullable(),
  status: z.string().min(1).optional(),
  expected_cents: z.number().int().optional(),
  recovered_cents: z.number().int().optional(),
  reference_number: z.string().optional().nullable(),
  filed_at: z.string().datetime().optional().nullable(),
  recovered_at: z.string().datetime().optional().nullable(),
  note: z.string().optional().nullable(),
})

const attachSchema = z.object({
  finding_ids: z.array(z.string().min(1)).min(1),
})

// Public: list claims (?workspace_id&status)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const conds = [eq(claims.workspace_id, workspaceId)]
  if (status) conds.push(eq(claims.status, status))
  const rows = await db
    .select()
    .from(claims)
    .where(and(...conds))
    .orderBy(desc(claims.created_at))
  return c.json(rows)
})

// Public: claim detail + attached findings + activity log
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [claim] = await db.select().from(claims).where(eq(claims.id, id))
  if (!claim) return c.json({ error: 'Not found' }, 404)

  const links = await db
    .select()
    .from(claim_findings)
    .where(eq(claim_findings.claim_id, id))
  const findingIds = links.map((l) => l.finding_id)
  const attachedFindings =
    findingIds.length > 0
      ? await db.select().from(findings).where(inArray(findings.id, findingIds))
      : []

  const activity = await db
    .select()
    .from(claim_activity)
    .where(eq(claim_activity.claim_id, id))
    .orderBy(desc(claim_activity.created_at))

  return c.json({ claim, findings: attachedFindings, activity })
})

// Auth: create claim (+ optional attach finding ids), logs activity
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [claim] = await db
    .insert(claims)
    .values({
      workspace_id: body.workspace_id,
      vendor_id: body.vendor_id ?? null,
      claim_type: body.claim_type,
      jurisdiction: body.jurisdiction ?? null,
      status: body.status,
      expected_cents: body.expected_cents,
      recovered_cents: body.recovered_cents,
      reference_number: body.reference_number ?? null,
      note: body.note ?? null,
      created_by: userId,
    })
    .returning()

  // Attach any provided findings that belong to the same workspace.
  if (body.finding_ids.length > 0) {
    const valid = await db
      .select()
      .from(findings)
      .where(
        and(
          inArray(findings.id, body.finding_ids),
          eq(findings.workspace_id, body.workspace_id),
        ),
      )
    for (const f of valid) {
      await db
        .insert(claim_findings)
        .values({
          workspace_id: body.workspace_id,
          claim_id: claim.id,
          finding_id: f.id,
        })
        .onConflictDoNothing({
          target: [claim_findings.claim_id, claim_findings.finding_id],
        })
    }
  }

  await db.insert(claim_activity).values({
    workspace_id: claim.workspace_id,
    claim_id: claim.id,
    action: 'created',
    detail: `Claim created with status ${claim.status}`,
    user_id: userId,
  })

  return c.json(claim, 201)
})

// Auth: update claim (status, recovered amount, etc.) with ownership check
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(claims).where(eq(claims.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = c.req.valid('json')
  const set: Record<string, unknown> = { updated_at: new Date() }
  if (body.vendor_id !== undefined) set.vendor_id = body.vendor_id
  if (body.claim_type !== undefined) set.claim_type = body.claim_type
  if (body.jurisdiction !== undefined) set.jurisdiction = body.jurisdiction
  if (body.status !== undefined) set.status = body.status
  if (body.expected_cents !== undefined) set.expected_cents = body.expected_cents
  if (body.recovered_cents !== undefined) set.recovered_cents = body.recovered_cents
  if (body.reference_number !== undefined) set.reference_number = body.reference_number
  if (body.note !== undefined) set.note = body.note
  if (body.filed_at !== undefined) set.filed_at = body.filed_at ? new Date(body.filed_at) : null
  if (body.recovered_at !== undefined) {
    set.recovered_at = body.recovered_at ? new Date(body.recovered_at) : null
  }

  const [updated] = await db.update(claims).set(set).where(eq(claims.id, id)).returning()

  const changed = Object.keys(set).filter((k) => k !== 'updated_at')
  await db.insert(claim_activity).values({
    workspace_id: updated.workspace_id,
    claim_id: updated.id,
    action: 'updated',
    detail:
      body.status !== undefined && body.status !== existing.status
        ? `Status ${existing.status} -> ${body.status}`
        : `Updated fields: ${changed.join(', ') || 'none'}`,
    user_id: userId,
  })

  return c.json(updated)
})

// Auth: attach findings to a claim {finding_ids[]}
router.post('/:id/findings', authMiddleware, zValidator('json', attachSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [claim] = await db.select().from(claims).where(eq(claims.id, id))
  if (!claim) return c.json({ error: 'Not found' }, 404)

  const { finding_ids } = c.req.valid('json')
  const valid = await db
    .select()
    .from(findings)
    .where(
      and(
        inArray(findings.id, finding_ids),
        eq(findings.workspace_id, claim.workspace_id),
      ),
    )

  let attached = 0
  for (const f of valid) {
    const res = await db
      .insert(claim_findings)
      .values({
        workspace_id: claim.workspace_id,
        claim_id: claim.id,
        finding_id: f.id,
      })
      .onConflictDoNothing({
        target: [claim_findings.claim_id, claim_findings.finding_id],
      })
      .returning()
    if (res.length > 0) attached++
  }

  if (attached > 0) {
    await db.insert(claim_activity).values({
      workspace_id: claim.workspace_id,
      claim_id: claim.id,
      action: 'findings_attached',
      detail: `Attached ${attached} finding(s)`,
      user_id: userId,
    })
  }

  return c.json({ attached })
})

// Auth: delete a claim (and its links + activity) with ownership check
router.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(claims).where(eq(claims.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(claim_findings).where(eq(claim_findings.claim_id, id))
  await db.delete(claim_activity).where(eq(claim_activity.claim_id, id))
  await db.delete(claims).where(eq(claims.id, id))

  return c.json({ success: true })
})

export default router
