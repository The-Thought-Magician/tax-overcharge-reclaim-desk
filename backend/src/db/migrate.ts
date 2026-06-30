import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    legal_entity text,
    nexus_states jsonb DEFAULT '[]'::jsonb,
    permits jsonb DEFAULT '[]'::jsonb,
    fiscal_year_start_month integer NOT NULL DEFAULT 1,
    default_ship_to jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'manager',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS vendors (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    dba text,
    tax_id text,
    default_state text,
    contact_email text,
    contact_name text,
    default_taxability text DEFAULT 'unknown',
    risk_score real DEFAULT 0,
    aliases jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS product_categories (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    code text,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    vendor_id text REFERENCES vendors(id),
    invoice_number text NOT NULL,
    invoice_date timestamptz,
    ship_to_state text,
    ship_to_county text,
    ship_to_city text,
    ship_to_zip text,
    subtotal_cents integer NOT NULL DEFAULT 0,
    tax_cents integer NOT NULL DEFAULT 0,
    total_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'imported',
    source text DEFAULT 'manual',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS invoice_lines (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    invoice_id text NOT NULL REFERENCES invoices(id),
    line_number integer NOT NULL DEFAULT 1,
    description text,
    gl_account text,
    category_id text REFERENCES product_categories(id),
    amount_cents integer NOT NULL DEFAULT 0,
    tax_cents integer NOT NULL DEFAULT 0,
    rate_charged real DEFAULT 0,
    jurisdiction_charged text,
    audit_result text DEFAULT 'unaudited',
    audit_reason text,
    recoverable_cents integer DEFAULT 0,
    audit_trace jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS jurisdictions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    code text NOT NULL,
    state text NOT NULL,
    county text,
    city text,
    freight_taxable boolean NOT NULL DEFAULT false,
    labor_taxable boolean NOT NULL DEFAULT false,
    saas_taxable boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, code)
  )`,

  `CREATE TABLE IF NOT EXISTS jurisdiction_rates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    jurisdiction_id text NOT NULL REFERENCES jurisdictions(id),
    state_rate real NOT NULL DEFAULT 0,
    county_rate real NOT NULL DEFAULT 0,
    city_rate real NOT NULL DEFAULT 0,
    district_rate real NOT NULL DEFAULT 0,
    combined_rate real NOT NULL DEFAULT 0,
    effective_from timestamptz,
    effective_to timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS taxability_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    category_id text NOT NULL REFERENCES product_categories(id),
    state text NOT NULL,
    taxability text NOT NULL DEFAULT 'taxable',
    reduced_rate real,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (category_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS exemption_certificates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    type text NOT NULL,
    state text NOT NULL,
    certificate_number text,
    valid_from timestamptz,
    valid_to timestamptz,
    status text NOT NULL DEFAULT 'valid',
    document_url text,
    note text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS certificate_coverage (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    certificate_id text NOT NULL REFERENCES exemption_certificates(id),
    vendor_id text REFERENCES vendors(id),
    category_id text REFERENCES product_categories(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS use_tax_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    vendor_id text REFERENCES vendors(id),
    invoice_id text REFERENCES invoices(id),
    period text,
    accrued_cents integer NOT NULL DEFAULT 0,
    matched boolean NOT NULL DEFAULT false,
    double_paid boolean NOT NULL DEFAULT false,
    note text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_runs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    scope text DEFAULT 'all',
    lines_scanned integer NOT NULL DEFAULT 0,
    findings_count integer NOT NULL DEFAULT 0,
    total_recoverable_cents integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'completed',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS findings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    audit_run_id text REFERENCES audit_runs(id),
    invoice_id text REFERENCES invoices(id),
    invoice_line_id text REFERENCES invoice_lines(id),
    vendor_id text REFERENCES vendors(id),
    type text NOT NULL,
    jurisdiction text,
    recoverable_cents integer NOT NULL DEFAULT 0,
    reason text,
    confidence real DEFAULT 1,
    status text NOT NULL DEFAULT 'identified',
    transaction_date timestamptz,
    statute_deadline timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS claims (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    vendor_id text REFERENCES vendors(id),
    claim_type text NOT NULL DEFAULT 'vendor_credit',
    jurisdiction text,
    status text NOT NULL DEFAULT 'draft',
    expected_cents integer NOT NULL DEFAULT 0,
    recovered_cents integer NOT NULL DEFAULT 0,
    reference_number text,
    filed_at timestamptz,
    recovered_at timestamptz,
    note text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS claim_findings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    claim_id text NOT NULL REFERENCES claims(id),
    finding_id text NOT NULL REFERENCES findings(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_id, finding_id)
  )`,

  `CREATE TABLE IF NOT EXISTS claim_activity (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    claim_id text NOT NULL REFERENCES claims(id),
    action text NOT NULL,
    detail text,
    user_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS statute_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    state text NOT NULL,
    window_months integer NOT NULL DEFAULT 36,
    basis text NOT NULL DEFAULT 'transaction',
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS saved_views (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    entity text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vendors_workspace ON vendors(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_lines_workspace ON invoice_lines(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_lines_category ON invoice_lines(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jurisdictions_workspace ON jurisdictions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_workspace ON jurisdiction_rates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_jurisdiction ON jurisdiction_rates(jurisdiction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_categories_workspace ON product_categories(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_taxability_rules_workspace ON taxability_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_taxability_rules_category ON taxability_rules(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exemption_certificates_workspace ON exemption_certificates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_certificate_coverage_workspace ON certificate_coverage(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_certificate_coverage_certificate ON certificate_coverage(certificate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_use_tax_entries_workspace ON use_tax_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_runs_workspace ON audit_runs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_workspace ON findings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_invoice ON findings(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_vendor ON findings(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_audit_run ON findings(audit_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_workspace ON claims(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_vendor ON claims(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_findings_workspace ON claim_findings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_findings_claim ON claim_findings(claim_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_activity_claim ON claim_activity(claim_id)`,
  `CREATE INDEX IF NOT EXISTS idx_statute_rules_workspace ON statute_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_workspace ON saved_views(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete')
}
