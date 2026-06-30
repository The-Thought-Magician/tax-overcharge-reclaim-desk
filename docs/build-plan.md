# TaxOverchargeReclaimDesk — Build Contract (Single Source of Truth)

This is the binding build contract. Filenames, mount paths, api method names, and page files declared here are authoritative. Every api method maps 1:1 to exactly one backend endpoint and is consumed by at least one page.

Stack: Hono 4.12.27 backend on Render, Next.js 16 + React 19 + Tailwind 4 frontend on Vercel, Neon Postgres via drizzle-orm 0.45.2, auth via `@neondatabase/auth@0.4.2-beta`. Backend trusts `X-User-Id` header; use `getUserId(c)` in every handler. Routes mount under `/api/v1` via a child Hono `api` router. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

---

## (a) Tables (columns)

- **workspaces** — id, name, legal_entity, nexus_states(jsonb), permits(jsonb), fiscal_year_start_month(int), default_ship_to(jsonb), created_by, created_at
- **workspace_members** — id, workspace_id(FK), user_id, role, created_at; UNIQUE(workspace_id,user_id)
- **vendors** — id, workspace_id(FK), name, dba, tax_id, default_state, contact_email, contact_name, default_taxability, risk_score(real), aliases(jsonb), notes, created_by, created_at
- **invoices** — id, workspace_id(FK), vendor_id(FK), invoice_number, invoice_date, ship_to_state, ship_to_county, ship_to_city, ship_to_zip, subtotal_cents(int), tax_cents(int), total_cents(int), status, source, created_by, created_at
- **invoice_lines** — id, workspace_id(FK), invoice_id(FK), line_number(int), description, gl_account, category_id(FK), amount_cents(int), tax_cents(int), rate_charged(real), jurisdiction_charged, audit_result, audit_reason, recoverable_cents(int), audit_trace(jsonb), created_at
- **jurisdictions** — id, workspace_id(FK), code, state, county, city, freight_taxable(bool), labor_taxable(bool), saas_taxable(bool), created_at; UNIQUE(workspace_id,code)
- **jurisdiction_rates** — id, workspace_id(FK), jurisdiction_id(FK), state_rate(real), county_rate(real), city_rate(real), district_rate(real), combined_rate(real), effective_from, effective_to, created_at
- **product_categories** — id, workspace_id(FK), name, code, description, created_at
- **taxability_rules** — id, workspace_id(FK), category_id(FK), state, taxability, reduced_rate(real), note, created_at; UNIQUE(category_id,state)
- **exemption_certificates** — id, workspace_id(FK), type, state, certificate_number, valid_from, valid_to, status, document_url, note, created_by, created_at
- **certificate_coverage** — id, workspace_id(FK), certificate_id(FK), vendor_id(FK), category_id(FK), created_at
- **use_tax_entries** — id, workspace_id(FK), vendor_id(FK), invoice_id(FK), period, accrued_cents(int), matched(bool), double_paid(bool), note, created_by, created_at
- **audit_runs** — id, workspace_id(FK), scope, lines_scanned(int), findings_count(int), total_recoverable_cents(int), status, created_by, created_at
- **findings** — id, workspace_id(FK), audit_run_id(FK), invoice_id(FK), invoice_line_id(FK), vendor_id(FK), type, jurisdiction, recoverable_cents(int), reason, confidence(real), status, transaction_date, statute_deadline, created_at, updated_at
- **claims** — id, workspace_id(FK), vendor_id(FK), claim_type, jurisdiction, status, expected_cents(int), recovered_cents(int), reference_number, filed_at, recovered_at, note, created_by, created_at, updated_at
- **claim_findings** — id, workspace_id(FK), claim_id(FK), finding_id(FK), created_at; UNIQUE(claim_id,finding_id)
- **claim_activity** — id, workspace_id(FK), claim_id(FK), action, detail, user_id, created_at
- **statute_rules** — id, workspace_id(FK), state, window_months(int), basis, note, created_at; UNIQUE(workspace_id,state)
- **saved_views** — id, workspace_id(FK), user_id, name, entity, filters(jsonb), is_default(bool), created_at
- **notifications** — id, workspace_id(FK), user_id, type, title, body, link, read(bool), created_at
- **activity_log** — id, workspace_id(FK), user_id, entity_type, entity_id, action, detail(jsonb), created_at
- **plans** — id(text PK, seeded 'free'/'pro'), name, price_cents(int)
- **subscriptions** — id, user_id(unique), plan_id(text FK), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

Conventions: every file `export default router`. Public reads (no auth). Auth-gated writes via `authMiddleware` + zod. Ownership = workspace membership checks. Response shapes use cents-as-integer.

### 1. `workspaces.ts` → mount `workspaces`
- `GET /` — auth — list workspaces the user is a member of — `Workspace[]`
- `GET /:id` — auth — get one workspace (membership checked) — `Workspace`
- `POST /` — auth — create workspace + owner membership — `Workspace`
- `PUT /:id` — auth — update workspace — `Workspace`
- `GET /:id/members` — auth — list members — `Member[]`
- `POST /:id/members` — auth — add member {user_id, role} — `Member`

### 2. `vendors.ts` → mount `vendors`
- `GET /` — public — list vendors (?workspace_id) — `Vendor[]`
- `GET /:id` — public — vendor detail — `Vendor`
- `POST /` — auth — create vendor — `Vendor`
- `PUT /:id` — auth — update vendor — `Vendor`
- `DELETE /:id` — auth — delete vendor — `{success}`

### 3. `invoices.ts` → mount `invoices`
- `GET /` — public — list invoices (?workspace_id&status) — `Invoice[]`
- `GET /:id` — public — invoice with lines — `{invoice, lines}`
- `POST /` — auth — create invoice (+optional lines) — `Invoice`
- `PUT /:id` — auth — update invoice — `Invoice`
- `DELETE /:id` — auth — delete invoice + its lines — `{success}`
- `POST /import` — auth — bulk import {workspace_id, invoices[]} — `{imported}`
- `POST /check-duplicates` — auth — duplicate detection {workspace_id} — `{duplicates}`

### 4. `invoiceLines.ts` → mount `invoice-lines`
- `GET /` — public — lines for an invoice (?invoice_id) — `Line[]`
- `PUT /:id` — auth — update a line (category, taxability override) — `Line`

### 5. `jurisdictions.ts` → mount `jurisdictions`
- `GET /` — public — list jurisdictions (?workspace_id) — `Jurisdiction[]`
- `GET /:id` — public — jurisdiction detail — `Jurisdiction`
- `POST /` — auth — create jurisdiction — `Jurisdiction`
- `PUT /:id` — auth — update jurisdiction — `Jurisdiction`
- `GET /lookup` — public — lookup by ?state&county&city — `Jurisdiction|null`

### 6. `rates.ts` → mount `rates`
- `GET /` — public — list rates (?jurisdiction_id) — `Rate[]`
- `POST /` — auth — create rate — `Rate`
- `PUT /:id` — auth — update rate — `Rate`
- `DELETE /:id` — auth — delete rate — `{success}`

### 7. `categories.ts` → mount `categories`
- `GET /` — public — list product categories (?workspace_id) — `Category[]`
- `POST /` — auth — create category — `Category`
- `PUT /:id` — auth — update category — `Category`
- `DELETE /:id` — auth — delete category — `{success}`

### 8. `taxability.ts` → mount `taxability`
- `GET /` — public — taxability rules (?workspace_id or ?category_id) — `Rule[]`
- `POST /` — auth — create rule — `Rule`
- `PUT /:id` — auth — update rule — `Rule`
- `DELETE /:id` — auth — delete rule — `{success}`

### 9. `certificates.ts` → mount `certificates`
- `GET /` — public — list certificates (?workspace_id) — `Certificate[]`
- `GET /:id` — public — certificate + coverage — `{certificate, coverage}`
- `POST /` — auth — create certificate — `Certificate`
- `PUT /:id` — auth — update certificate — `Certificate`
- `DELETE /:id` — auth — delete certificate — `{success}`
- `GET /expiring` — public — expiring-soon (?workspace_id&days) — `Certificate[]`
- `POST /:id/coverage` — auth — add coverage {vendor_id?, category_id?} — `Coverage`

### 10. `useTax.ts` → mount `use-tax`
- `GET /` — public — use-tax entries (?workspace_id&period) — `Entry[]`
- `POST /` — auth — create entry — `Entry`
- `PUT /:id` — auth — update entry — `Entry`
- `POST /reconcile` — auth — run reconciliation {workspace_id, period?} → flags double_paid — `{matched, double_paid, entries}`

### 11. `audit.ts` → mount `audit`
- `GET /runs` — public — audit-run history (?workspace_id) — `AuditRun[]`
- `GET /runs/:id` — public — run detail — `AuditRun`
- `POST /run` — auth — run full audit {workspace_id, scope?} → creates audit_run + findings — `{run, findings_count, total_recoverable_cents}`

### 12. `findings.ts` → mount `findings`
- `GET /` — public — findings ledger (?workspace_id&type&status) — `Finding[]`
- `GET /:id` — public — finding detail — `Finding`
- `PUT /:id` — auth — update finding (status transition, write-off) — `Finding`
- `POST /:id/reaudit` — auth — re-evaluate single finding — `Finding`

### 13. `statute.ts` → mount `statute`
- `GET /rules` — public — SOL rules (?workspace_id) — `StatuteRule[]`
- `POST /rules` — auth — create/update SOL rule (upsert by state) — `StatuteRule`
- `GET /expiring` — public — findings nearing statute (?workspace_id&days) — `Finding[]`

### 14. `claims.ts` → mount `claims`
- `GET /` — public — list claims (?workspace_id&status) — `Claim[]`
- `GET /:id` — public — claim + findings + activity — `{claim, findings, activity}`
- `POST /` — auth — create claim (+attach finding ids) — `Claim`
- `PUT /:id` — auth — update claim (status, recovered amount) — `Claim`
- `POST /:id/findings` — auth — attach findings {finding_ids[]} — `{attached}`
- `DELETE /:id` — auth — delete claim — `{success}`

### 15. `claimActivity.ts` → mount `claim-activity`
- `GET /` — public — activity for a claim (?claim_id) — `Activity[]`
- `POST /` — auth — add activity {claim_id, action, detail} — `Activity`

### 16. `offenders.ts` → mount `offenders`
- `GET /` — public — repeat-offender ranking (?workspace_id) — `OffenderRow[]` (vendor, total_overcharge_cents, finding_count, by_type)

### 17. `analytics.ts` → mount `analytics`
- `GET /overview` — public — KPIs (?workspace_id) — `{total_claimable_cents, total_recovered_cents, recovery_rate, at_risk_cents, leakage_rate}`
- `GET /breakdown` — public — breakdown by ?workspace_id&dimension(type|vendor|jurisdiction|period) — `BreakdownRow[]`

### 18. `reports.ts` → mount `reports`
- `GET /findings` — public — findings export rows (?workspace_id&type&status) — `Row[]`
- `GET /recovery` — public — recovery summary by period (?workspace_id) — `PeriodRow[]`
- `GET /vendor-scorecard` — public — vendor scorecard (?workspace_id) — `ScorecardRow[]`

### 19. `alerts.ts` → mount `alerts`
- `GET /` — public — composed alerts feed (?workspace_id): cert-expiring + statute-expiring + high-value findings — `Alert[]`

### 20. `notifications.ts` → mount `notifications`
- `GET /` — auth — current user notifications (?workspace_id) — `Notification[]`
- `POST /:id/read` — auth — mark read — `Notification`
- `POST /read-all` — auth — mark all read {workspace_id} — `{updated}`

### 21. `savedViews.ts` → mount `saved-views`
- `GET /` — auth — saved views for user (?workspace_id&entity) — `SavedView[]`
- `POST /` — auth — create saved view — `SavedView`
- `DELETE /:id` — auth — delete saved view — `{success}`

### 22. `activity.ts` → mount `activity`
- `GET /` — public — activity log (?workspace_id&entity_type&entity_id) — `LogEntry[]`

### 23. `seed.ts` → mount `seed`
- `POST /sample` — auth — generate sample workspace data {workspace_id} (vendors, invoices+lines, jurisdictions+rates, categories+taxability, certificates, statute rules, use-tax) — `{created}`

### 24. `billing.ts` → mount `billing`
- `GET /plan` — public(header user) — `{subscription, plan, stripeEnabled}`
- `POST /checkout` — public(header user) — 503 when unconfigured — `{url}`
- `POST /portal` — public(header user) — 503 when unconfigured — `{url}`
- `POST /webhook` — public — Stripe webhook (503 when unconfigured) — `{received}`

`/health` is served directly in `index.ts` (not a route file).

---

## (c) lib/api.ts methods (method → relative proxy path → verb)

Workspaces:
- `getWorkspaces()` → GET `/api/proxy/workspaces`
- `getWorkspace(id)` → GET `/api/proxy/workspaces/{id}`
- `createWorkspace(data)` → POST `/api/proxy/workspaces`
- `updateWorkspace(id,data)` → PUT `/api/proxy/workspaces/{id}`
- `getWorkspaceMembers(id)` → GET `/api/proxy/workspaces/{id}/members`
- `addWorkspaceMember(id,data)` → POST `/api/proxy/workspaces/{id}/members`

Vendors:
- `getVendors(workspaceId)` → GET `/api/proxy/vendors?workspace_id=`
- `getVendor(id)` → GET `/api/proxy/vendors/{id}`
- `createVendor(data)` → POST `/api/proxy/vendors`
- `updateVendor(id,data)` → PUT `/api/proxy/vendors/{id}`
- `deleteVendor(id)` → DELETE `/api/proxy/vendors/{id}`

Invoices:
- `getInvoices(workspaceId,status?)` → GET `/api/proxy/invoices?workspace_id=`
- `getInvoice(id)` → GET `/api/proxy/invoices/{id}`
- `createInvoice(data)` → POST `/api/proxy/invoices`
- `updateInvoice(id,data)` → PUT `/api/proxy/invoices/{id}`
- `deleteInvoice(id)` → DELETE `/api/proxy/invoices/{id}`
- `importInvoices(data)` → POST `/api/proxy/invoices/import`
- `checkDuplicateInvoices(data)` → POST `/api/proxy/invoices/check-duplicates`

Invoice lines:
- `getInvoiceLines(invoiceId)` → GET `/api/proxy/invoice-lines?invoice_id=`
- `updateInvoiceLine(id,data)` → PUT `/api/proxy/invoice-lines/{id}`

Jurisdictions:
- `getJurisdictions(workspaceId)` → GET `/api/proxy/jurisdictions?workspace_id=`
- `getJurisdiction(id)` → GET `/api/proxy/jurisdictions/{id}`
- `createJurisdiction(data)` → POST `/api/proxy/jurisdictions`
- `updateJurisdiction(id,data)` → PUT `/api/proxy/jurisdictions/{id}`
- `lookupJurisdiction(params)` → GET `/api/proxy/jurisdictions/lookup?state=&county=&city=`

Rates:
- `getRates(jurisdictionId)` → GET `/api/proxy/rates?jurisdiction_id=`
- `createRate(data)` → POST `/api/proxy/rates`
- `updateRate(id,data)` → PUT `/api/proxy/rates/{id}`
- `deleteRate(id)` → DELETE `/api/proxy/rates/{id}`

Categories:
- `getCategories(workspaceId)` → GET `/api/proxy/categories?workspace_id=`
- `createCategory(data)` → POST `/api/proxy/categories`
- `updateCategory(id,data)` → PUT `/api/proxy/categories/{id}`
- `deleteCategory(id)` → DELETE `/api/proxy/categories/{id}`

Taxability:
- `getTaxabilityRules(params)` → GET `/api/proxy/taxability?workspace_id=`
- `createTaxabilityRule(data)` → POST `/api/proxy/taxability`
- `updateTaxabilityRule(id,data)` → PUT `/api/proxy/taxability/{id}`
- `deleteTaxabilityRule(id)` → DELETE `/api/proxy/taxability/{id}`

Certificates:
- `getCertificates(workspaceId)` → GET `/api/proxy/certificates?workspace_id=`
- `getCertificate(id)` → GET `/api/proxy/certificates/{id}`
- `createCertificate(data)` → POST `/api/proxy/certificates`
- `updateCertificate(id,data)` → PUT `/api/proxy/certificates/{id}`
- `deleteCertificate(id)` → DELETE `/api/proxy/certificates/{id}`
- `getExpiringCertificates(workspaceId,days?)` → GET `/api/proxy/certificates/expiring?workspace_id=`
- `addCertificateCoverage(id,data)` → POST `/api/proxy/certificates/{id}/coverage`

Use-tax:
- `getUseTaxEntries(workspaceId,period?)` → GET `/api/proxy/use-tax?workspace_id=`
- `createUseTaxEntry(data)` → POST `/api/proxy/use-tax`
- `updateUseTaxEntry(id,data)` → PUT `/api/proxy/use-tax/{id}`
- `reconcileUseTax(data)` → POST `/api/proxy/use-tax/reconcile`

Audit:
- `getAuditRuns(workspaceId)` → GET `/api/proxy/audit/runs?workspace_id=`
- `getAuditRun(id)` → GET `/api/proxy/audit/runs/{id}`
- `runAudit(data)` → POST `/api/proxy/audit/run`

Findings:
- `getFindings(params)` → GET `/api/proxy/findings?workspace_id=`
- `getFinding(id)` → GET `/api/proxy/findings/{id}`
- `updateFinding(id,data)` → PUT `/api/proxy/findings/{id}`
- `reauditFinding(id)` → POST `/api/proxy/findings/{id}/reaudit`

Statute:
- `getStatuteRules(workspaceId)` → GET `/api/proxy/statute/rules?workspace_id=`
- `upsertStatuteRule(data)` → POST `/api/proxy/statute/rules`
- `getExpiringFindings(workspaceId,days?)` → GET `/api/proxy/statute/expiring?workspace_id=`

Claims:
- `getClaims(workspaceId,status?)` → GET `/api/proxy/claims?workspace_id=`
- `getClaim(id)` → GET `/api/proxy/claims/{id}`
- `createClaim(data)` → POST `/api/proxy/claims`
- `updateClaim(id,data)` → PUT `/api/proxy/claims/{id}`
- `attachFindingsToClaim(id,data)` → POST `/api/proxy/claims/{id}/findings`
- `deleteClaim(id)` → DELETE `/api/proxy/claims/{id}`

Claim activity:
- `getClaimActivity(claimId)` → GET `/api/proxy/claim-activity?claim_id=`
- `addClaimActivity(data)` → POST `/api/proxy/claim-activity`

Offenders:
- `getOffenders(workspaceId)` → GET `/api/proxy/offenders?workspace_id=`

Analytics:
- `getAnalyticsOverview(workspaceId)` → GET `/api/proxy/analytics/overview?workspace_id=`
- `getAnalyticsBreakdown(workspaceId,dimension)` → GET `/api/proxy/analytics/breakdown?workspace_id=&dimension=`

Reports:
- `getFindingsReport(params)` → GET `/api/proxy/reports/findings?workspace_id=`
- `getRecoveryReport(workspaceId)` → GET `/api/proxy/reports/recovery?workspace_id=`
- `getVendorScorecard(workspaceId)` → GET `/api/proxy/reports/vendor-scorecard?workspace_id=`

Alerts:
- `getAlerts(workspaceId)` → GET `/api/proxy/alerts?workspace_id=`

Notifications:
- `getNotifications(workspaceId)` → GET `/api/proxy/notifications?workspace_id=`
- `markNotificationRead(id)` → POST `/api/proxy/notifications/{id}/read`
- `markAllNotificationsRead(data)` → POST `/api/proxy/notifications/read-all`

Saved views:
- `getSavedViews(params)` → GET `/api/proxy/saved-views?workspace_id=`
- `createSavedView(data)` → POST `/api/proxy/saved-views`
- `deleteSavedView(id)` → DELETE `/api/proxy/saved-views/{id}`

Activity:
- `getActivityLog(params)` → GET `/api/proxy/activity?workspace_id=`

Seed:
- `seedSampleData(data)` → POST `/api/proxy/seed/sample`

Billing:
- `getBillingPlan()` → GET `/api/proxy/billing/plan`
- `createCheckout()` → POST `/api/proxy/billing/checkout`
- `createPortal()` → POST `/api/proxy/billing/portal`

---

## (d) Pages (URL → file → kind → api methods used → renders)

Public:
1. `/` → `web/app/page.tsx` → public → none → static landing: hero, feature grid, CTAs to sign-up.
2. `/auth/sign-in` → `web/app/auth/sign-in/page.tsx` → public → authClient.signIn → email/password sign-in form.
3. `/auth/sign-up` → `web/app/auth/sign-up/page.tsx` → public → authClient.signUp → name/email/password sign-up form.
4. `/pricing` → `web/app/pricing/page.tsx` → public → none → static pricing (Free + Pro).

Dashboard (wrapped by `web/app/dashboard/layout.tsx` → DashboardLayout sidebar):
5. `/dashboard` → `web/app/dashboard/page.tsx` → dashboard → getAnalyticsOverview, getAlerts, getExpiringFindings → recovery KPIs, at-risk-by-statute, alerts feed.
6. `/dashboard/invoices` → `web/app/dashboard/invoices/page.tsx` → dashboard → getInvoices, createInvoice, importInvoices, checkDuplicateInvoices, getVendors → invoice list, import, duplicate check.
7. `/dashboard/invoices/[id]` → `web/app/dashboard/invoices/[id]/page.tsx` → dashboard → getInvoice, getInvoiceLines, updateInvoiceLine, getCategories → invoice header + line-level audit results.
8. `/dashboard/vendors` → `web/app/dashboard/vendors/page.tsx` → dashboard → getVendors, createVendor, deleteVendor → vendor registry.
9. `/dashboard/vendors/[id]` → `web/app/dashboard/vendors/[id]/page.tsx` → dashboard → getVendor, updateVendor, getInvoices, getFindings → vendor detail, risk, overcharge history.
10. `/dashboard/offenders` → `web/app/dashboard/offenders/page.tsx` → dashboard → getOffenders → repeat-offender ranking with by-type breakdown.
11. `/dashboard/certificates` → `web/app/dashboard/certificates/page.tsx` → dashboard → getCertificates, createCertificate, updateCertificate, deleteCertificate, getExpiringCertificates, addCertificateCoverage, getVendors, getCategories → certificate registry + coverage + expiry.
12. `/dashboard/jurisdictions` → `web/app/dashboard/jurisdictions/page.tsx` → dashboard → getJurisdictions, createJurisdiction, updateJurisdiction, getRates, createRate, updateRate, deleteRate, lookupJurisdiction → jurisdictions + rate tables.
13. `/dashboard/categories` → `web/app/dashboard/categories/page.tsx` → dashboard → getCategories, createCategory, updateCategory, deleteCategory, getTaxabilityRules, createTaxabilityRule, updateTaxabilityRule, deleteTaxabilityRule → category list + taxability matrix.
14. `/dashboard/use-tax` → `web/app/dashboard/use-tax/page.tsx` → dashboard → getUseTaxEntries, createUseTaxEntry, updateUseTaxEntry, reconcileUseTax → use-tax reconciliation worksheet.
15. `/dashboard/audit` → `web/app/dashboard/audit/page.tsx` → dashboard → getAuditRuns, getAuditRun, runAudit → run audits + history.
16. `/dashboard/findings` → `web/app/dashboard/findings/page.tsx` → dashboard → getFindings, getFinding, updateFinding, reauditFinding, createClaim → findings ledger with status pipeline.
17. `/dashboard/statute` → `web/app/dashboard/statute/page.tsx` → dashboard → getStatuteRules, upsertStatuteRule, getExpiringFindings → SOL rules + expiring queue/calendar.
18. `/dashboard/claims` → `web/app/dashboard/claims/page.tsx` → dashboard → getClaims, createClaim, getVendors → refund-claim list.
19. `/dashboard/claims/[id]` → `web/app/dashboard/claims/[id]/page.tsx` → dashboard → getClaim, updateClaim, attachFindingsToClaim, getClaimActivity, addClaimActivity, getFindings → claim detail + activity.
20. `/dashboard/analytics` → `web/app/dashboard/analytics/page.tsx` → dashboard → getAnalyticsOverview, getAnalyticsBreakdown → recovery analytics charts.
21. `/dashboard/reports` → `web/app/dashboard/reports/page.tsx` → dashboard → getFindingsReport, getRecoveryReport, getVendorScorecard → reports + CSV export.
22. `/dashboard/notifications` → `web/app/dashboard/notifications/page.tsx` → dashboard → getNotifications, markNotificationRead, markAllNotificationsRead → notification feed.
23. `/dashboard/saved-views` → `web/app/dashboard/saved-views/page.tsx` → dashboard → getSavedViews, createSavedView, deleteSavedView → saved views manager.
24. `/dashboard/settings` → `web/app/dashboard/settings/page.tsx` → dashboard → getWorkspaces, getWorkspace, createWorkspace, updateWorkspace, getWorkspaceMembers, addWorkspaceMember, seedSampleData, getBillingPlan, createCheckout, createPortal, getActivityLog → workspace profile, members, seed sample data, billing, activity log.

Route handlers (not pages): `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav sections

- **Overview**: Dashboard (`/dashboard`), Analytics (`/dashboard/analytics`)
- **Audit**: Invoices (`/dashboard/invoices`), Audit Runs (`/dashboard/audit`), Findings (`/dashboard/findings`), Use-Tax (`/dashboard/use-tax`)
- **Recovery**: Claims (`/dashboard/claims`), Statute Clock (`/dashboard/statute`), Reports (`/dashboard/reports`)
- **Reference Data**: Vendors (`/dashboard/vendors`), Repeat Offenders (`/dashboard/offenders`), Certificates (`/dashboard/certificates`), Jurisdictions (`/dashboard/jurisdictions`), Categories (`/dashboard/categories`)
- **Account**: Notifications (`/dashboard/notifications`), Saved Views (`/dashboard/saved-views`), Settings (`/dashboard/settings`)
