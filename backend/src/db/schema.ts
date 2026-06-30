import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Core / workspace
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  legal_entity: text('legal_entity'),
  nexus_states: jsonb('nexus_states').$type<string[]>().default([]),
  permits: jsonb('permits').$type<Array<{ state: string; type: string; number: string }>>().default([]),
  fiscal_year_start_month: integer('fiscal_year_start_month').default(1).notNull(),
  default_ship_to: jsonb('default_ship_to').$type<{ line1?: string; city?: string; county?: string; state?: string; zip?: string }>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('manager'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const vendors = pgTable('vendors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  dba: text('dba'),
  tax_id: text('tax_id'),
  default_state: text('default_state'),
  contact_email: text('contact_email'),
  contact_name: text('contact_name'),
  default_taxability: text('default_taxability').default('unknown'),
  risk_score: real('risk_score').default(0),
  aliases: jsonb('aliases').$type<string[]>().default([]),
  notes: text('notes'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Invoices & lines
// ---------------------------------------------------------------------------

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  vendor_id: text('vendor_id').references(() => vendors.id),
  invoice_number: text('invoice_number').notNull(),
  invoice_date: timestamp('invoice_date'),
  ship_to_state: text('ship_to_state'),
  ship_to_county: text('ship_to_county'),
  ship_to_city: text('ship_to_city'),
  ship_to_zip: text('ship_to_zip'),
  subtotal_cents: integer('subtotal_cents').default(0).notNull(),
  tax_cents: integer('tax_cents').default(0).notNull(),
  total_cents: integer('total_cents').default(0).notNull(),
  status: text('status').notNull().default('imported'),
  source: text('source').default('manual'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const invoice_lines = pgTable('invoice_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  invoice_id: text('invoice_id').notNull().references(() => invoices.id),
  line_number: integer('line_number').default(1).notNull(),
  description: text('description'),
  gl_account: text('gl_account'),
  category_id: text('category_id').references(() => product_categories.id),
  amount_cents: integer('amount_cents').default(0).notNull(),
  tax_cents: integer('tax_cents').default(0).notNull(),
  rate_charged: real('rate_charged').default(0),
  jurisdiction_charged: text('jurisdiction_charged'),
  audit_result: text('audit_result').default('unaudited'),
  audit_reason: text('audit_reason'),
  recoverable_cents: integer('recoverable_cents').default(0),
  audit_trace: jsonb('audit_trace').$type<Array<{ step: string; detail: string }>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Jurisdictions & rates
// ---------------------------------------------------------------------------

export const jurisdictions = pgTable('jurisdictions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  code: text('code').notNull(),
  state: text('state').notNull(),
  county: text('county'),
  city: text('city'),
  freight_taxable: boolean('freight_taxable').default(false).notNull(),
  labor_taxable: boolean('labor_taxable').default(false).notNull(),
  saas_taxable: boolean('saas_taxable').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.code)])

export const jurisdiction_rates = pgTable('jurisdiction_rates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  jurisdiction_id: text('jurisdiction_id').notNull().references(() => jurisdictions.id),
  state_rate: real('state_rate').default(0).notNull(),
  county_rate: real('county_rate').default(0).notNull(),
  city_rate: real('city_rate').default(0).notNull(),
  district_rate: real('district_rate').default(0).notNull(),
  combined_rate: real('combined_rate').default(0).notNull(),
  effective_from: timestamp('effective_from'),
  effective_to: timestamp('effective_to'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Product categories & taxability rules
// ---------------------------------------------------------------------------

export const product_categories = pgTable('product_categories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  code: text('code'),
  description: text('description'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const taxability_rules = pgTable('taxability_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  category_id: text('category_id').notNull().references(() => product_categories.id),
  state: text('state').notNull(),
  taxability: text('taxability').notNull().default('taxable'),
  reduced_rate: real('reduced_rate'),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.category_id, t.state)])

// ---------------------------------------------------------------------------
// Exemption certificates & coverage
// ---------------------------------------------------------------------------

export const exemption_certificates = pgTable('exemption_certificates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  type: text('type').notNull(),
  state: text('state').notNull(),
  certificate_number: text('certificate_number'),
  valid_from: timestamp('valid_from'),
  valid_to: timestamp('valid_to'),
  status: text('status').notNull().default('valid'),
  document_url: text('document_url'),
  note: text('note'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const certificate_coverage = pgTable('certificate_coverage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  certificate_id: text('certificate_id').notNull().references(() => exemption_certificates.id),
  vendor_id: text('vendor_id').references(() => vendors.id),
  category_id: text('category_id').references(() => product_categories.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Use-tax self-assessment
// ---------------------------------------------------------------------------

export const use_tax_entries = pgTable('use_tax_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  vendor_id: text('vendor_id').references(() => vendors.id),
  invoice_id: text('invoice_id').references(() => invoices.id),
  period: text('period'),
  accrued_cents: integer('accrued_cents').default(0).notNull(),
  matched: boolean('matched').default(false).notNull(),
  double_paid: boolean('double_paid').default(false).notNull(),
  note: text('note'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Audit runs
// ---------------------------------------------------------------------------

export const audit_runs = pgTable('audit_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  scope: text('scope').default('all'),
  lines_scanned: integer('lines_scanned').default(0).notNull(),
  findings_count: integer('findings_count').default(0).notNull(),
  total_recoverable_cents: integer('total_recoverable_cents').default(0).notNull(),
  status: text('status').notNull().default('completed'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Findings ledger
// ---------------------------------------------------------------------------

export const findings = pgTable('findings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  audit_run_id: text('audit_run_id').references(() => audit_runs.id),
  invoice_id: text('invoice_id').references(() => invoices.id),
  invoice_line_id: text('invoice_line_id').references(() => invoice_lines.id),
  vendor_id: text('vendor_id').references(() => vendors.id),
  type: text('type').notNull(),
  jurisdiction: text('jurisdiction'),
  recoverable_cents: integer('recoverable_cents').default(0).notNull(),
  reason: text('reason'),
  confidence: real('confidence').default(1),
  status: text('status').notNull().default('identified'),
  transaction_date: timestamp('transaction_date'),
  statute_deadline: timestamp('statute_deadline'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export const claims = pgTable('claims', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  vendor_id: text('vendor_id').references(() => vendors.id),
  claim_type: text('claim_type').notNull().default('vendor_credit'),
  jurisdiction: text('jurisdiction'),
  status: text('status').notNull().default('draft'),
  expected_cents: integer('expected_cents').default(0).notNull(),
  recovered_cents: integer('recovered_cents').default(0).notNull(),
  reference_number: text('reference_number'),
  filed_at: timestamp('filed_at'),
  recovered_at: timestamp('recovered_at'),
  note: text('note'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const claim_findings = pgTable('claim_findings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  claim_id: text('claim_id').notNull().references(() => claims.id),
  finding_id: text('finding_id').notNull().references(() => findings.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.claim_id, t.finding_id)])

export const claim_activity = pgTable('claim_activity', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  claim_id: text('claim_id').notNull().references(() => claims.id),
  action: text('action').notNull(),
  detail: text('detail'),
  user_id: text('user_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Statute rules
// ---------------------------------------------------------------------------

export const statute_rules = pgTable('statute_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  state: text('state').notNull(),
  window_months: integer('window_months').notNull().default(36),
  basis: text('basis').notNull().default('transaction'),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.state)])

// ---------------------------------------------------------------------------
// Saved views, notifications, activity log
// ---------------------------------------------------------------------------

export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  entity: text('entity').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  is_default: boolean('is_default').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: boolean('read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
