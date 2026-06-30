import { Hono } from 'hono'
import { db } from '../db/index.js'
import { exemption_certificates, findings } from '../db/schema.js'
import { and, eq, gte, lte, desc } from 'drizzle-orm'

const router = new Hono()

// High-value findings threshold (in cents) for the alerts feed.
const HIGH_VALUE_CENTS = 50_000

interface Alert {
  id: string
  kind: 'cert-expiring' | 'statute-expiring' | 'high-value-finding'
  severity: 'low' | 'medium' | 'high'
  title: string
  body: string
  link: string | null
  amount_cents: number | null
  deadline: string | null
  entity_id: string
  created_at: string
}

function daysUntil(date: Date, now: number): number {
  return Math.ceil((date.getTime() - now) / 86_400_000)
}

// GET / — composed alerts feed: cert-expiring + statute-expiring + high-value findings
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const certDays = parseInt(c.req.query('cert_days') ?? '60', 10)
  const statuteDays = parseInt(c.req.query('statute_days') ?? '90', 10)

  const now = Date.now()
  const certHorizon = new Date(now + certDays * 86_400_000)
  const statuteHorizon = new Date(now + statuteDays * 86_400_000)

  const alerts: Alert[] = []

  // 1. Expiring exemption certificates (valid_to within the horizon).
  const certs = await db
    .select()
    .from(exemption_certificates)
    .where(
      and(
        eq(exemption_certificates.workspace_id, workspaceId),
        lte(exemption_certificates.valid_to, certHorizon),
        gte(exemption_certificates.valid_to, new Date(now)),
      ),
    )
  for (const cert of certs) {
    if (!cert.valid_to) continue
    const d = daysUntil(cert.valid_to, now)
    const severity: Alert['severity'] = d <= 14 ? 'high' : d <= 30 ? 'medium' : 'low'
    alerts.push({
      id: `cert-${cert.id}`,
      kind: 'cert-expiring',
      severity,
      title: `Exemption certificate expiring in ${d} day(s)`,
      body: `${cert.type} certificate for ${cert.state}${cert.certificate_number ? ` (#${cert.certificate_number})` : ''} expires ${cert.valid_to.toISOString().slice(0, 10)}.`,
      link: `/dashboard/certificates`,
      amount_cents: null,
      deadline: cert.valid_to.toISOString(),
      entity_id: cert.id,
      created_at: cert.created_at.toISOString(),
    })
  }

  // 2. Findings nearing statute deadline (open findings with a deadline inside the horizon).
  const statuteFindings = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.workspace_id, workspaceId),
        lte(findings.statute_deadline, statuteHorizon),
        gte(findings.statute_deadline, new Date(now)),
      ),
    )
  for (const f of statuteFindings) {
    if (!f.statute_deadline) continue
    if (f.status === 'recovered' || f.status === 'written_off' || f.status === 'rejected') continue
    const d = daysUntil(f.statute_deadline, now)
    const severity: Alert['severity'] = d <= 30 ? 'high' : d <= 60 ? 'medium' : 'low'
    alerts.push({
      id: `statute-${f.id}`,
      kind: 'statute-expiring',
      severity,
      title: `Refund window closing in ${d} day(s)`,
      body: `${f.type} finding${f.jurisdiction ? ` in ${f.jurisdiction}` : ''} worth $${(f.recoverable_cents / 100).toFixed(2)} hits its statute deadline ${f.statute_deadline.toISOString().slice(0, 10)}.`,
      link: `/dashboard/findings`,
      amount_cents: f.recoverable_cents,
      deadline: f.statute_deadline.toISOString(),
      entity_id: f.id,
      created_at: f.created_at.toISOString(),
    })
  }

  // 3. High-value open findings (recoverable_cents above threshold).
  const highValue = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.workspace_id, workspaceId),
        gte(findings.recoverable_cents, HIGH_VALUE_CENTS),
      ),
    )
    .orderBy(desc(findings.recoverable_cents))
  for (const f of highValue) {
    if (f.status === 'recovered' || f.status === 'written_off' || f.status === 'rejected') continue
    const severity: Alert['severity'] =
      f.recoverable_cents >= HIGH_VALUE_CENTS * 4
        ? 'high'
        : f.recoverable_cents >= HIGH_VALUE_CENTS * 2
          ? 'medium'
          : 'low'
    alerts.push({
      id: `finding-${f.id}`,
      kind: 'high-value-finding',
      severity,
      title: `High-value finding: $${(f.recoverable_cents / 100).toFixed(2)} recoverable`,
      body: `${f.type} finding${f.jurisdiction ? ` in ${f.jurisdiction}` : ''} — ${f.reason ?? 'overcharge identified'}.`,
      link: `/dashboard/findings`,
      amount_cents: f.recoverable_cents,
      deadline: f.statute_deadline ? f.statute_deadline.toISOString() : null,
      entity_id: f.id,
      created_at: f.created_at.toISOString(),
    })
  }

  // Order: high severity first, then soonest deadline, then largest amount.
  const sevRank: Record<Alert['severity'], number> = { high: 0, medium: 1, low: 2 }
  alerts.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity]
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline)
    if (a.deadline && !b.deadline) return -1
    if (!a.deadline && b.deadline) return 1
    return (b.amount_cents ?? 0) - (a.amount_cents ?? 0)
  })

  return c.json(alerts)
})

export default router
