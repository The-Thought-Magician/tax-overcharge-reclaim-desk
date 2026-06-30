import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspace_members,
  vendors,
  product_categories,
  taxability_rules,
  jurisdictions,
  jurisdiction_rates,
  invoices,
  invoice_lines,
  exemption_certificates,
  certificate_coverage,
  use_tax_entries,
  statute_rules,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const seedSchema = z.object({
  workspace_id: z.string().min(1),
})

// Membership / ownership check — only members of the workspace may seed it.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

function monthsAgo(n: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// POST /sample — generate a coherent sample dataset for one workspace so the
// dashboard is demoable. Auth-gated, membership-checked. Idempotency: if the
// workspace already has vendors we do not double-seed.
// ---------------------------------------------------------------------------
router.post('/sample', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Idempotency guard.
  const existingVendors = await db
    .select()
    .from(vendors)
    .where(eq(vendors.workspace_id, workspace_id))
    .limit(1)
  if (existingVendors.length > 0) {
    return c.json({ created: {}, skipped: true, reason: 'Workspace already has data' })
  }

  const created: Record<string, number> = {
    vendors: 0,
    categories: 0,
    taxability_rules: 0,
    jurisdictions: 0,
    rates: 0,
    invoices: 0,
    invoice_lines: 0,
    certificates: 0,
    coverage: 0,
    use_tax_entries: 0,
    statute_rules: 0,
  }

  // -------------------------------------------------------------------------
  // Product categories
  // -------------------------------------------------------------------------
  const categoryDefs = [
    { name: 'SaaS Subscriptions', code: 'SAAS', description: 'Cloud software subscriptions' },
    { name: 'Manufacturing Equipment', code: 'MFG-EQ', description: 'Production machinery' },
    { name: 'Office Supplies', code: 'OFFICE', description: 'General office consumables' },
    { name: 'Professional Services', code: 'SVC', description: 'Consulting and labor' },
    { name: 'Freight & Shipping', code: 'FREIGHT', description: 'Inbound/outbound freight' },
  ]
  const insertedCategories = await db
    .insert(product_categories)
    .values(categoryDefs.map((cd) => ({ ...cd, workspace_id })))
    .returning()
  created.categories = insertedCategories.length

  const catByCode = new Map(insertedCategories.map((cat) => [cat.code as string, cat]))
  const saasCat = catByCode.get('SAAS')!
  const mfgCat = catByCode.get('MFG-EQ')!
  const officeCat = catByCode.get('OFFICE')!
  const svcCat = catByCode.get('SVC')!
  const freightCat = catByCode.get('FREIGHT')!

  // -------------------------------------------------------------------------
  // Taxability rules — these define what SHOULD have been charged. Mismatches
  // against invoice lines below become recoverable findings on audit.
  // -------------------------------------------------------------------------
  const taxabilityDefs = [
    // SaaS is exempt in CA (no sales tax on digital services there).
    { category_id: saasCat.id, state: 'CA', taxability: 'exempt', reduced_rate: null, note: 'CA does not tax SaaS' },
    { category_id: saasCat.id, state: 'TX', taxability: 'taxable', reduced_rate: null, note: 'TX taxes 80% of SaaS' },
    // Manufacturing equipment exempt in TX (manufacturing exemption).
    { category_id: mfgCat.id, state: 'TX', taxability: 'exempt', reduced_rate: null, note: 'TX manufacturing exemption' },
    { category_id: mfgCat.id, state: 'CA', taxability: 'taxable', reduced_rate: null, note: 'Standard rate' },
    // Office supplies taxable everywhere.
    { category_id: officeCat.id, state: 'CA', taxability: 'taxable', reduced_rate: null, note: 'Tangible goods' },
    { category_id: officeCat.id, state: 'NY', taxability: 'taxable', reduced_rate: null, note: 'Tangible goods' },
    // Professional services exempt in CA and NY (services not taxed).
    { category_id: svcCat.id, state: 'CA', taxability: 'exempt', reduced_rate: null, note: 'Services not taxed in CA' },
    { category_id: svcCat.id, state: 'NY', taxability: 'exempt', reduced_rate: null, note: 'Services not taxed in NY' },
    // Freight exempt when separately stated.
    { category_id: freightCat.id, state: 'CA', taxability: 'exempt', reduced_rate: null, note: 'Separately-stated freight exempt' },
  ]
  const insertedRules = await db
    .insert(taxability_rules)
    .values(taxabilityDefs.map((r) => ({ ...r, workspace_id })))
    .returning()
  created.taxability_rules = insertedRules.length

  // -------------------------------------------------------------------------
  // Jurisdictions + rates
  // -------------------------------------------------------------------------
  const jurisdictionDefs = [
    {
      code: 'CA-SF',
      state: 'CA',
      county: 'San Francisco',
      city: 'San Francisco',
      freight_taxable: false,
      labor_taxable: false,
      saas_taxable: false,
      rate: { state_rate: 0.06, county_rate: 0.0025, city_rate: 0.0, district_rate: 0.01375, combined_rate: 0.07625 },
    },
    {
      code: 'CA-LA',
      state: 'CA',
      county: 'Los Angeles',
      city: 'Los Angeles',
      freight_taxable: false,
      labor_taxable: false,
      saas_taxable: false,
      rate: { state_rate: 0.06, county_rate: 0.0025, city_rate: 0.0, district_rate: 0.0275, combined_rate: 0.095 },
    },
    {
      code: 'TX-AUS',
      state: 'TX',
      county: 'Travis',
      city: 'Austin',
      freight_taxable: false,
      labor_taxable: false,
      saas_taxable: true,
      rate: { state_rate: 0.0625, county_rate: 0.0, city_rate: 0.01, district_rate: 0.01, combined_rate: 0.0825 },
    },
    {
      code: 'NY-NYC',
      state: 'NY',
      county: 'New York',
      city: 'New York',
      freight_taxable: true,
      labor_taxable: false,
      saas_taxable: false,
      rate: { state_rate: 0.04, county_rate: 0.0, city_rate: 0.045, district_rate: 0.00375, combined_rate: 0.08875 },
    },
  ]

  const jurByCode = new Map<string, typeof jurisdictions.$inferSelect>()
  for (const jd of jurisdictionDefs) {
    const { rate, ...jurFields } = jd
    const [jur] = await db
      .insert(jurisdictions)
      .values({ ...jurFields, workspace_id })
      .returning()
    created.jurisdictions += 1
    jurByCode.set(jur.code as string, jur)
    await db.insert(jurisdiction_rates).values({
      workspace_id,
      jurisdiction_id: jur.id,
      ...rate,
      effective_from: monthsAgo(36),
      effective_to: null,
    })
    created.rates += 1
  }

  // -------------------------------------------------------------------------
  // Vendors
  // -------------------------------------------------------------------------
  const vendorDefs = [
    { name: 'CloudStack Inc.', dba: 'CloudStack', tax_id: '94-1234567', default_state: 'CA', contact_email: 'ar@cloudstack.example', contact_name: 'Dana Reed', default_taxability: 'taxable', risk_score: 0.7, aliases: ['CloudStack', 'Cloud Stack Inc'], notes: 'Charges CA tax on SaaS in error.' },
    { name: 'Precision Machinery Co.', dba: null, tax_id: '74-7654321', default_state: 'TX', contact_email: 'billing@precision.example', contact_name: 'Sam Ortiz', default_taxability: 'exempt', risk_score: 0.5, aliases: ['Precision Machinery'], notes: 'Ignores TX manufacturing exemption.' },
    { name: 'Metro Office Depot', dba: 'Metro Office', tax_id: '13-2468013', default_state: 'NY', contact_email: 'accounts@metrooffice.example', contact_name: 'Lee Chan', default_taxability: 'taxable', risk_score: 0.2, aliases: ['Metro Office'], notes: 'Generally accurate.' },
    { name: 'Apex Consulting LLC', dba: null, tax_id: '20-1357924', default_state: 'CA', contact_email: 'finance@apex.example', contact_name: 'Robin Vale', default_taxability: 'exempt', risk_score: 0.6, aliases: ['Apex'], notes: 'Sometimes taxes exempt services.' },
  ]
  const insertedVendors = await db
    .insert(vendors)
    .values(vendorDefs.map((v) => ({ ...v, workspace_id, created_by: userId })))
    .returning()
  created.vendors = insertedVendors.length
  const [cloudVendor, precisionVendor, metroVendor, apexVendor] = insertedVendors

  // -------------------------------------------------------------------------
  // Invoices + lines. Some lines are over-taxed (recoverable), some correct.
  // tax_cents on a line = amount_cents * rate_charged.
  // -------------------------------------------------------------------------
  type LineSeed = {
    line_number: number
    description: string
    gl_account: string
    category_id: string
    amount_cents: number
    rate_charged: number
    jurisdiction_charged: string
  }
  type InvoiceSeed = {
    vendor_id: string
    invoice_number: string
    monthsBack: number
    ship_to_state: string
    ship_to_county: string
    ship_to_city: string
    ship_to_zip: string
    jurCode: string
    lines: LineSeed[]
  }

  const invoiceDefs: InvoiceSeed[] = [
    {
      vendor_id: cloudVendor.id,
      invoice_number: 'CS-1001',
      monthsBack: 4,
      ship_to_state: 'CA',
      ship_to_county: 'San Francisco',
      ship_to_city: 'San Francisco',
      ship_to_zip: '94105',
      jurCode: 'CA-SF',
      lines: [
        // SaaS taxed in CA where it is exempt → fully recoverable.
        { line_number: 1, description: 'Annual SaaS subscription', gl_account: '6500', category_id: saasCat.id, amount_cents: 1_200_000, rate_charged: 0.07625, jurisdiction_charged: 'CA-SF' },
      ],
    },
    {
      vendor_id: precisionVendor.id,
      invoice_number: 'PM-5582',
      monthsBack: 6,
      ship_to_state: 'TX',
      ship_to_county: 'Travis',
      ship_to_city: 'Austin',
      ship_to_zip: '78701',
      jurCode: 'TX-AUS',
      lines: [
        // Manufacturing equipment taxed in TX where exempt → recoverable.
        { line_number: 1, description: 'CNC lathe unit', gl_account: '1500', category_id: mfgCat.id, amount_cents: 4_500_000, rate_charged: 0.0825, jurisdiction_charged: 'TX-AUS' },
        // Separately-stated freight; TX-AUS freight not taxable here → recoverable.
        { line_number: 2, description: 'Inbound freight', gl_account: '5100', category_id: freightCat.id, amount_cents: 80_000, rate_charged: 0.0825, jurisdiction_charged: 'TX-AUS' },
      ],
    },
    {
      vendor_id: metroVendor.id,
      invoice_number: 'MO-9043',
      monthsBack: 2,
      ship_to_state: 'NY',
      ship_to_county: 'New York',
      ship_to_city: 'New York',
      ship_to_zip: '10001',
      jurCode: 'NY-NYC',
      lines: [
        // Office supplies correctly taxed in NY → no finding.
        { line_number: 1, description: 'Printer paper & toner', gl_account: '6100', category_id: officeCat.id, amount_cents: 95_000, rate_charged: 0.08875, jurisdiction_charged: 'NY-NYC' },
      ],
    },
    {
      vendor_id: apexVendor.id,
      invoice_number: 'AP-2207',
      monthsBack: 9,
      ship_to_state: 'CA',
      ship_to_county: 'Los Angeles',
      ship_to_city: 'Los Angeles',
      ship_to_zip: '90012',
      jurCode: 'CA-LA',
      lines: [
        // Professional services taxed in CA where exempt → recoverable.
        { line_number: 1, description: 'Strategy consulting retainer', gl_account: '6700', category_id: svcCat.id, amount_cents: 850_000, rate_charged: 0.095, jurisdiction_charged: 'CA-LA' },
        // Office supplies correctly taxed in CA → no finding.
        { line_number: 2, description: 'Workshop materials', gl_account: '6100', category_id: officeCat.id, amount_cents: 30_000, rate_charged: 0.095, jurisdiction_charged: 'CA-LA' },
      ],
    },
  ]

  for (const inv of invoiceDefs) {
    const lineTaxes = inv.lines.map((l) => Math.round(l.amount_cents * l.rate_charged))
    const subtotal = inv.lines.reduce((s, l) => s + l.amount_cents, 0)
    const taxTotal = lineTaxes.reduce((s, t) => s + t, 0)
    const invoiceDate = monthsAgo(inv.monthsBack)

    const [invoiceRow] = await db
      .insert(invoices)
      .values({
        workspace_id,
        vendor_id: inv.vendor_id,
        invoice_number: inv.invoice_number,
        invoice_date: invoiceDate,
        ship_to_state: inv.ship_to_state,
        ship_to_county: inv.ship_to_county,
        ship_to_city: inv.ship_to_city,
        ship_to_zip: inv.ship_to_zip,
        subtotal_cents: subtotal,
        tax_cents: taxTotal,
        total_cents: subtotal + taxTotal,
        status: 'imported',
        source: 'seed',
        created_by: userId,
      })
      .returning()
    created.invoices += 1

    await db.insert(invoice_lines).values(
      inv.lines.map((l, idx) => ({
        workspace_id,
        invoice_id: invoiceRow.id,
        line_number: l.line_number,
        description: l.description,
        gl_account: l.gl_account,
        category_id: l.category_id,
        amount_cents: l.amount_cents,
        tax_cents: lineTaxes[idx],
        rate_charged: l.rate_charged,
        jurisdiction_charged: l.jurisdiction_charged,
        audit_result: 'unaudited',
      })),
    )
    created.invoice_lines += inv.lines.length
  }

  // -------------------------------------------------------------------------
  // Exemption certificates + coverage
  // -------------------------------------------------------------------------
  const [resaleCert] = await db
    .insert(exemption_certificates)
    .values({
      workspace_id,
      type: 'resale',
      state: 'CA',
      certificate_number: 'CA-RESALE-0099',
      valid_from: monthsAgo(12),
      valid_to: monthsAgo(-12),
      status: 'valid',
      document_url: null,
      note: 'Blanket resale certificate',
      created_by: userId,
    })
    .returning()
  created.certificates += 1

  const [mfgCert] = await db
    .insert(exemption_certificates)
    .values({
      workspace_id,
      type: 'manufacturing',
      state: 'TX',
      certificate_number: 'TX-MFG-0042',
      valid_from: monthsAgo(24),
      // Expiring soon (within ~20 days) so the alerts/expiring feed has content.
      valid_to: (() => {
        const d = new Date()
        d.setDate(d.getDate() + 20)
        return d
      })(),
      status: 'valid',
      document_url: null,
      note: 'Manufacturing exemption certificate',
      created_by: userId,
    })
    .returning()
  created.certificates += 1

  await db.insert(certificate_coverage).values([
    { workspace_id, certificate_id: resaleCert.id, vendor_id: cloudVendor.id, category_id: null },
    { workspace_id, certificate_id: mfgCert.id, vendor_id: precisionVendor.id, category_id: mfgCat.id },
  ])
  created.coverage += 2

  // -------------------------------------------------------------------------
  // Use-tax entries — one matched, one accrued without a matching invoice
  // (potential double-pay flag on reconciliation).
  // -------------------------------------------------------------------------
  const useTaxDefs = [
    { vendor_id: precisionVendor.id, invoice_id: null, period: periodOf(monthsAgo(6)), accrued_cents: 371_250, matched: false, double_paid: false, note: 'Accrued use tax on out-of-state equipment purchase' },
    { vendor_id: metroVendor.id, invoice_id: null, period: periodOf(monthsAgo(2)), accrued_cents: 8_400, matched: false, double_paid: false, note: 'Accrued use tax on office supplies' },
  ]
  await db.insert(use_tax_entries).values(
    useTaxDefs.map((e) => ({ ...e, workspace_id, created_by: userId })),
  )
  created.use_tax_entries = useTaxDefs.length

  // -------------------------------------------------------------------------
  // Statute-of-limitations rules per nexus state (upsert by workspace+state).
  // -------------------------------------------------------------------------
  const statuteDefs = [
    { state: 'CA', window_months: 36, basis: 'transaction', note: 'CA 3-year refund window' },
    { state: 'TX', window_months: 48, basis: 'transaction', note: 'TX 4-year refund window' },
    { state: 'NY', window_months: 36, basis: 'transaction', note: 'NY 3-year refund window' },
  ]
  for (const s of statuteDefs) {
    await db
      .insert(statute_rules)
      .values({ ...s, workspace_id })
      .onConflictDoUpdate({
        target: [statute_rules.workspace_id, statute_rules.state],
        set: { window_months: s.window_months, basis: s.basis, note: s.note },
      })
    created.statute_rules += 1
  }

  // Activity-log entry recording the seed action.
  await db.insert(activity_log).values({
    workspace_id,
    user_id: userId,
    entity_type: 'workspace',
    entity_id: workspace_id,
    action: 'seed_sample_data',
    detail: created,
  })

  return c.json({ created }, 201)
})

export default router
