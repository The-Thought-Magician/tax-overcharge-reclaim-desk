import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  exemption_certificates,
  certificate_coverage,
  workspace_members,
  vendors,
  product_categories,
} from '../db/schema.js'
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
  type: z.string().min(1),
  state: z.string().min(1),
  certificate_number: z.string().optional(),
  valid_from: z.string().datetime().optional(),
  valid_to: z.string().datetime().optional(),
  status: z.enum(['valid', 'expired', 'pending', 'revoked']).optional().default('valid'),
  document_url: z.string().url().optional(),
  note: z.string().optional(),
})

const updateSchema = z.object({
  type: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  certificate_number: z.string().optional(),
  valid_from: z.string().datetime().nullable().optional(),
  valid_to: z.string().datetime().nullable().optional(),
  status: z.enum(['valid', 'expired', 'pending', 'revoked']).optional(),
  document_url: z.string().url().nullable().optional(),
  note: z.string().optional(),
})

const coverageSchema = z
  .object({
    vendor_id: z.string().min(1).optional(),
    category_id: z.string().min(1).optional(),
  })
  .refine((d) => d.vendor_id || d.category_id, {
    message: 'vendor_id or category_id is required',
  })

// Public: list certificates for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.workspace_id, workspaceId))
    .orderBy(desc(exemption_certificates.created_at))
  return c.json(rows)
})

// Public: expiring-soon certificates (?workspace_id&days). Must precede /:id.
router.get('/expiring', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const days = parseInt(c.req.query('days') ?? '30', 10)
  const window = Number.isFinite(days) && days > 0 ? days : 30
  const now = Date.now()
  const cutoff = now + window * 86_400_000
  const rows = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.workspace_id, workspaceId))
  // A certificate is "expiring soon" if it has a valid_to within [now, cutoff],
  // or already past (lapsed). Sorted by soonest expiry first.
  const expiring = rows
    .filter((r) => {
      if (!r.valid_to) return false
      const t = new Date(r.valid_to).getTime()
      return t <= cutoff
    })
    .sort((a, b) => new Date(a.valid_to!).getTime() - new Date(b.valid_to!).getTime())
  return c.json(expiring)
})

// Public: certificate + its coverage links
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [certificate] = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.id, id))
  if (!certificate) return c.json({ error: 'Not found' }, 404)
  const coverage = await db
    .select()
    .from(certificate_coverage)
    .where(eq(certificate_coverage.certificate_id, id))
    .orderBy(desc(certificate_coverage.created_at))
  return c.json({ certificate, coverage })
})

// Auth: create certificate
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [row] = await db
    .insert(exemption_certificates)
    .values({
      workspace_id: body.workspace_id,
      type: body.type,
      state: body.state,
      certificate_number: body.certificate_number ?? null,
      valid_from: body.valid_from ? new Date(body.valid_from) : null,
      valid_to: body.valid_to ? new Date(body.valid_to) : null,
      status: body.status,
      document_url: body.document_url ?? null,
      note: body.note ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update certificate
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.type !== undefined) patch.type = body.type
  if (body.state !== undefined) patch.state = body.state
  if (body.certificate_number !== undefined) patch.certificate_number = body.certificate_number
  if (body.valid_from !== undefined) patch.valid_from = body.valid_from ? new Date(body.valid_from) : null
  if (body.valid_to !== undefined) patch.valid_to = body.valid_to ? new Date(body.valid_to) : null
  if (body.status !== undefined) patch.status = body.status
  if (body.document_url !== undefined) patch.document_url = body.document_url
  if (body.note !== undefined) patch.note = body.note
  const [updated] = await db
    .update(exemption_certificates)
    .set(patch)
    .where(eq(exemption_certificates.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete certificate (and its coverage links)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(certificate_coverage).where(eq(certificate_coverage.certificate_id, id))
  await db.delete(exemption_certificates).where(eq(exemption_certificates.id, id))
  return c.json({ success: true })
})

// Auth: add coverage link {vendor_id?, category_id?}
router.post('/:id/coverage', authMiddleware, zValidator('json', coverageSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [certificate] = await db
    .select()
    .from(exemption_certificates)
    .where(eq(exemption_certificates.id, id))
  if (!certificate) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(certificate.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  // Validate referenced vendor/category belong to the same workspace.
  if (body.vendor_id) {
    const [v] = await db.select().from(vendors).where(eq(vendors.id, body.vendor_id))
    if (!v) return c.json({ error: 'Vendor not found' }, 404)
    if (v.workspace_id !== certificate.workspace_id) {
      return c.json({ error: 'Vendor does not belong to workspace' }, 400)
    }
  }
  if (body.category_id) {
    const [cat] = await db
      .select()
      .from(product_categories)
      .where(eq(product_categories.id, body.category_id))
    if (!cat) return c.json({ error: 'Category not found' }, 404)
    if (cat.workspace_id !== certificate.workspace_id) {
      return c.json({ error: 'Category does not belong to workspace' }, 400)
    }
  }
  const [row] = await db
    .insert(certificate_coverage)
    .values({
      workspace_id: certificate.workspace_id,
      certificate_id: id,
      vendor_id: body.vendor_id ?? null,
      category_id: body.category_id ?? null,
    })
    .returning()
  return c.json(row, 201)
})

export default router
