import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  vendors,
  product_categories,
  jurisdictions,
  jurisdiction_rates,
  invoices,
  invoice_lines,
  statute_rules,
} from './db/schema.js'

import workspaceRoutes from './routes/workspaces.js'
import vendorRoutes from './routes/vendors.js'
import invoiceRoutes from './routes/invoices.js'
import invoiceLineRoutes from './routes/invoiceLines.js'
import jurisdictionRoutes from './routes/jurisdictions.js'
import rateRoutes from './routes/rates.js'
import categoryRoutes from './routes/categories.js'
import taxabilityRoutes from './routes/taxability.js'
import certificateRoutes from './routes/certificates.js'
import useTaxRoutes from './routes/useTax.js'
import auditRoutes from './routes/audit.js'
import findingRoutes from './routes/findings.js'
import statuteRoutes from './routes/statute.js'
import claimRoutes from './routes/claims.js'
import claimActivityRoutes from './routes/claimActivity.js'
import offenderRoutes from './routes/offenders.js'
import analyticsRoutes from './routes/analytics.js'
import reportRoutes from './routes/reports.js'
import alertRoutes from './routes/alerts.js'
import notificationRoutes from './routes/notifications.js'
import savedViewRoutes from './routes/savedViews.js'
import activityRoutes from './routes/activity.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://tax-overcharge-reclaim-desk-ventures.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspaceRoutes)
api.route('/vendors', vendorRoutes)
api.route('/invoices', invoiceRoutes)
api.route('/invoice-lines', invoiceLineRoutes)
api.route('/jurisdictions', jurisdictionRoutes)
api.route('/rates', rateRoutes)
api.route('/categories', categoryRoutes)
api.route('/taxability', taxabilityRoutes)
api.route('/certificates', certificateRoutes)
api.route('/use-tax', useTaxRoutes)
api.route('/audit', auditRoutes)
api.route('/findings', findingRoutes)
api.route('/statute', statuteRoutes)
api.route('/claims', claimRoutes)
api.route('/claim-activity', claimActivityRoutes)
api.route('/offenders', offenderRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/reports', reportRoutes)
api.route('/alerts', alertRoutes)
api.route('/notifications', notificationRoutes)
api.route('/saved-views', savedViewRoutes)
api.route('/activity', activityRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Idempotent seed (count-then-insert). Seeds the two billing plans plus a small
// demo workspace so the dashboard renders on a fresh database.
// ---------------------------------------------------------------------------

const DEMO_WS_ID = 'demo-workspace'
const DEMO_USER = 'demo-user'

async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  // Demo workspace + reference data
  const existingWs = await db.select().from(workspaces).limit(1)
  if (existingWs.length === 0) {
    await db.insert(workspaces).values({
      id: DEMO_WS_ID,
      name: 'Demo Co.',
      legal_entity: 'Demo Co. LLC',
      nexus_states: ['CA', 'TX', 'NY'],
      permits: [{ state: 'CA', type: 'seller', number: 'CA-123456' }],
      fiscal_year_start_month: 1,
      default_ship_to: { city: 'San Francisco', county: 'San Francisco', state: 'CA', zip: '94105' },
      created_by: DEMO_USER,
    })
    await db.insert(workspace_members).values({
      id: 'demo-member',
      workspace_id: DEMO_WS_ID,
      user_id: DEMO_USER,
      role: 'owner',
    })

    await db.insert(product_categories).values([
      { id: 'demo-cat-saas', workspace_id: DEMO_WS_ID, name: 'SaaS Subscription', code: 'SAAS', description: 'Cloud software subscriptions' },
      { id: 'demo-cat-mfg', workspace_id: DEMO_WS_ID, name: 'Manufacturing Equipment', code: 'MFG', description: 'Production machinery' },
      { id: 'demo-cat-office', workspace_id: DEMO_WS_ID, name: 'Office Supplies', code: 'OFFICE', description: 'General office goods' },
    ])

    await db.insert(jurisdictions).values({
      id: 'demo-juris-ca-sf',
      workspace_id: DEMO_WS_ID,
      code: 'CA-SF',
      state: 'CA',
      county: 'San Francisco',
      city: 'San Francisco',
      freight_taxable: false,
      labor_taxable: false,
      saas_taxable: false,
    })
    await db.insert(jurisdiction_rates).values({
      id: 'demo-rate-ca-sf',
      workspace_id: DEMO_WS_ID,
      jurisdiction_id: 'demo-juris-ca-sf',
      state_rate: 0.06,
      county_rate: 0.0025,
      city_rate: 0.0,
      district_rate: 0.01375,
      combined_rate: 0.07625,
    })

    await db.insert(statute_rules).values([
      { id: 'demo-sol-ca', workspace_id: DEMO_WS_ID, state: 'CA', window_months: 36, basis: 'transaction', note: 'CA 3-year refund window' },
      { id: 'demo-sol-tx', workspace_id: DEMO_WS_ID, state: 'TX', window_months: 48, basis: 'transaction', note: 'TX 4-year refund window' },
    ])

    await db.insert(vendors).values([
      { id: 'demo-vendor-cloudco', workspace_id: DEMO_WS_ID, name: 'CloudCo Inc.', default_state: 'CA', default_taxability: 'exempt', risk_score: 0.7, created_by: DEMO_USER },
      { id: 'demo-vendor-acme', workspace_id: DEMO_WS_ID, name: 'Acme Industrial', default_state: 'TX', default_taxability: 'taxable', risk_score: 0.2, created_by: DEMO_USER },
    ])

    await db.insert(invoices).values({
      id: 'demo-invoice-1',
      workspace_id: DEMO_WS_ID,
      vendor_id: 'demo-vendor-cloudco',
      invoice_number: 'INV-1001',
      invoice_date: new Date(),
      ship_to_state: 'CA',
      ship_to_county: 'San Francisco',
      ship_to_city: 'San Francisco',
      ship_to_zip: '94105',
      subtotal_cents: 100000,
      tax_cents: 7625,
      total_cents: 107625,
      status: 'imported',
      source: 'manual',
      created_by: DEMO_USER,
    })
    await db.insert(invoice_lines).values({
      id: 'demo-line-1',
      workspace_id: DEMO_WS_ID,
      invoice_id: 'demo-invoice-1',
      line_number: 1,
      description: 'Annual SaaS subscription',
      category_id: 'demo-cat-saas',
      amount_cents: 100000,
      tax_cents: 7625,
      rate_charged: 0.07625,
      jurisdiction_charged: 'CA-SF',
      audit_result: 'unaudited',
    })

    console.log('Seeded demo workspace')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent)
// each wrapped in its own try/catch. Never await DB work before serve().
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

async function boot() {
  try {
    await migrate()
    console.log('Migration complete')
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
    console.log('Seed complete')
  } catch (e) {
    console.error('Seed error:', e)
  }
}

void boot()

export default app
