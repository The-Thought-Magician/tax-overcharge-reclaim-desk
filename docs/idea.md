# TaxOverchargeReclaimDesk — Feature Specification

## Overview

TaxOverchargeReclaimDesk is a reverse sales/use-tax recovery platform. It ingests already-paid vendor invoices, audits every taxed line against jurisdiction rate tables and the company's exemption-certificate registry, surfaces overcharges (wrong rates, taxed-despite-exemption, double-paid use tax), and drives each finding through a refund-claim workflow to recovered cash — all while tracking a statute-of-limitations clock per claim so refundable money is not lost to lapsed deadlines.

It is a self-serve alternative to contingency reverse-audit firms (who take 25-35% of recovered cash). The company keeps the recovery minus a flat SaaS fee.

## Problem

Multi-state companies routinely overpay sales and use tax on vendor invoices:
- Vendors charge tax on purchases that qualify for a valid exemption (resale, manufacturing, R&D, nonprofit, government, direct-pay permit).
- Vendors apply the wrong jurisdiction rate (charging the state+county+city+district combined rate for a ship-to that sits in a lower-rate jurisdiction, or charging tax in a jurisdiction where the item is not taxable).
- The buyer self-assesses use tax on a purchase the vendor already taxed (double payment).
- Tax is charged on freight, installation, or services that are non-taxable in the relevant state.

This recovery work runs against a statute-of-limitations clock (commonly 36-48 months from the transaction or filing date, varying by state). The work is almost never done systematically in-house, so companies either leave the cash on the table or pay a reverse-audit firm a large contingency fee.

## Target Users

- Indirect Tax Managers at multi-state companies with significant exempt purchases.
- Tax Directors overseeing audit posture and recovery programs.
- Controllers and VP Finance who own the recovered-cash number.
- Tax analysts and AP specialists who do the line-level review and assemble refund packages.

### Buyer

Indirect Tax Manager or Controller at a multi-state company, measured on recovered cash and audit posture, with tax-tech budget authority.

## Why this is NOT an existing project

Near-neighbors and why they are distinct:

- **tax-calculation / tax-platform (Avalara, Vertex, Sovos, TaxJar):** These do *forward* rate determination at the point of sale/purchase — deciding what tax *should* be applied going forward. TaxOverchargeReclaimDesk works *backward* on invoices already paid, hunting for money to claw back. It consumes rate tables, it does not sell rate determination.
- **freight-invoice-audit (carrier billing audit):** Audits carrier billing accuracy (duplicate charges, wrong accessorials, weight/dimension errors) on freight bills. We audit the *sales/use-tax line* on any vendor invoice, with jurisdiction and exemption logic — a completely different domain than freight rating.
- **interchange-leakage-auditor (sibling):** Audits card-processing interchange/fee leakage. Same "find money you overpaid" shape, but the substance is payment-card economics, not tax law.
- **vendor-price-increase-defense-desk (sibling):** Tracks and contests supplier price increases. It is about unit price and contract compliance, not the tax line, jurisdiction rates, or exemption certificates.

What is unique here: reverse sales/use-tax recovery on already-paid invoices, combining (a) per-line taxability/exemption matching against a certificate registry, (b) jurisdiction rate validation against multi-level rate tables, (c) use-tax double-payment reconciliation, and (d) a statute-of-limitations-aware refund-claim pipeline that converts findings into filed claims and recovered cash.

---

## Major Feature Sections

### 1. Workspace & Company Profile
- Multi-workspace model (one workspace per legal entity / filing group).
- Company nexus footprint: states where the company is registered and files.
- Registered tax IDs / permits per state (sales tax permit, use tax, direct-pay permit).
- Fiscal calendar and filing-period configuration.
- Default ship-to / ship-from locations.
- Team membership and roles (manager, analyst, viewer).

### 2. Vendor Registry
- Vendor master with legal name, DBA, tax IDs, default jurisdiction.
- Per-vendor default taxability assumptions.
- Vendor contact for refund correspondence.
- Vendor risk score (computed from overcharge history).
- Merge/dedupe vendors; vendor aliases.
- Vendor notes and attachments.

### 3. Invoice Ingestion
- Manual invoice entry with header (vendor, invoice number, date, ship-to, totals).
- Bulk CSV/JSON import of invoices and lines.
- Per-line capture: description, GL account, amount, tax amount, tax rate charged, jurisdiction charged, product tax category.
- Invoice status lifecycle (imported, audited, has-findings, cleared).
- Duplicate-invoice detection.
- Sample-data seeder generating realistic invoices, vendors, rates, and certificates for demo.

### 4. Jurisdiction Rate Tables
- State/county/city/district combined rate records with effective-date ranges.
- Rate lookup by jurisdiction code or ship-to address components.
- Product-category taxability matrix per state (taxable, exempt, reduced).
- Special rules: freight taxability, installation/labor taxability, software/SaaS taxability per state.
- Rate version history and effective-date handling.
- Seeded rate set for common US jurisdictions.

### 5. Exemption-Certificate Registry
- Certificate records: type (resale, manufacturing, R&D, nonprofit, government, direct-pay), issuing state, certificate number, validity dates, covered vendors/categories.
- Certificate status (valid, expired, expiring-soon, missing).
- Link certificates to vendors and to product categories.
- Expiration alerts and renewal tracking.
- Certificate document attachments.
- Coverage map: which purchases each certificate should have exempted.

### 6. Tax-Line Auditor (Taxability Engine)
- For each taxed line, determine whether tax should have been charged given the product category, ship-to jurisdiction, and applicable exemption certificate.
- Flag "taxed-despite-valid-exemption" findings.
- Flag "taxed-non-taxable-category" findings (e.g., taxed freight in a non-freight-tax state).
- Deterministic rule trace explaining each decision.
- Per-line audit result records with confidence and reason codes.
- Re-audit on demand when rates/certificates change.

### 7. Jurisdiction Rate-Validation Engine
- Compare the rate charged on each line against the correct combined rate for the ship-to jurisdiction and effective date.
- Flag "over-rated" findings with the dollar delta (charged rate vs correct rate).
- Detect wrong-jurisdiction charges (tax assigned to wrong state/locality).
- Detect district/special-tax misapplication.
- Compute recoverable amount per over-rate finding.

### 8. Use-Tax Self-Assessment Reconciliation
- Import the company's accrued/self-assessed use tax entries.
- Match self-assessed entries to vendor-charged tax on the same purchase.
- Flag "double-paid" findings where both the vendor charged tax and the company accrued use tax.
- Reconciliation worksheet per period.
- Net use-tax-due adjustment suggestions.

### 9. Findings Ledger (Recovered-and-Claimable)
- Unified ledger of every finding: type, invoice/line, vendor, jurisdiction, recoverable amount, status.
- Statute-of-limitations clock per finding (computed from transaction/filing date + state SOL window).
- Status pipeline: identified, in-claim, claimed, recovered, written-off, expired.
- Aging buckets by days-to-statute-expiry.
- Total claimable vs total recovered roll-up.

### 10. Statute-of-Limitations Engine
- Per-state SOL window configuration (months from transaction or filing date).
- Compute deadline per finding; days remaining.
- Expiring-soon queue (configurable threshold).
- Auto-flag findings that crossed the statute date as expired.
- SOL calendar/heatmap view.

### 11. Refund-Claim Workflow
- Group findings into a refund claim (by vendor or by jurisdiction).
- Claim lifecycle: draft, submitted, acknowledged, approved, partially-recovered, recovered, denied.
- Track claim type: vendor credit request vs direct state refund filing.
- Per-claim recovered amount, recovery date, and reference number.
- Claim activity log and correspondence tracking.
- Generate claim package summary (findings, evidence, totals).

### 12. Vendor Credit-Request Tracking
- Draft credit-request letters to vendors for vendor-side overcharges.
- Track vendor response and credit memo received.
- Reconcile received credits against expected amounts.

### 13. State Refund-Filing Tracking
- Track direct-to-state refund claims (form type, jurisdiction, filing date).
- Track state acknowledgement, audit, and payment.
- Per-jurisdiction refund status board.

### 14. Repeat-Offender Vendor Dashboard
- Rank vendors by total overcharge dollars and overcharge frequency.
- Per-vendor breakdown by finding type.
- Trend over time; flag chronic offenders.
- Recommended action per offender (request blanket credit, send certificate, escalate).

### 15. Product-Category Taxability Matrix
- Manage the company's product/GL categories and their expected taxability per state.
- Map invoice lines to categories.
- Editable taxability overrides with audit trail.

### 16. Audit Runs & Batch Processing
- Run a full audit across selected invoices/periods.
- Audit-run record with summary stats (lines scanned, findings, total recoverable).
- Incremental re-audit when rates/certificates/categories change.
- Audit-run history.

### 17. Analytics & Recovery Dashboard
- KPIs: total claimable, total recovered, recovery rate, at-risk-by-statute.
- Breakdown by finding type, vendor, jurisdiction, period.
- Recovery trend over time.
- Leakage rate (overcharged $ / total tax paid).

### 18. Reports & Exports
- Findings report (filterable export).
- Claim package export.
- Recovery summary report by period.
- Vendor scorecard export.
- CSV/JSON export of any ledger view.

### 19. Alerts & Notifications
- Certificate-expiring alerts.
- Statute-expiring-soon alerts.
- New high-value findings alerts.
- Claim status-change notifications.
- Per-user notification feed and mark-read.

### 20. Saved Views & Filters
- Save filtered findings/invoices/claims views.
- Shareable workspace views.
- Default landing view per user.

### 21. Activity Log & Audit Trail
- Immutable activity log of every state change (finding status, claim status, certificate edits, rate edits).
- Per-entity timeline.
- Who-changed-what for audit defensibility.

### 22. Billing & Plans
- Free plan for all signed-in users (all features free).
- Stripe-optional Pro plan (checkout/portal/webhook return 503 when Stripe unconfigured).
- Plan and subscription status surface.

---

## Data Model (tables)

- workspaces
- workspace_members
- vendors
- invoices
- invoice_lines
- jurisdictions
- jurisdiction_rates
- product_categories
- taxability_rules
- exemption_certificates
- certificate_coverage
- use_tax_entries
- audit_runs
- findings
- claims
- claim_findings
- claim_activity
- statute_rules
- saved_views
- notifications
- activity_log
- plans
- subscriptions

## API Surface (high level)

- /workspaces — CRUD + members
- /vendors — CRUD + risk + offenders
- /invoices — CRUD + bulk import + duplicate check
- /invoice-lines — read/update line audit results
- /jurisdictions — CRUD + rate lookup
- /rates — jurisdiction rate CRUD + lookup
- /categories — product category + taxability matrix
- /taxability — taxability rules CRUD
- /certificates — exemption certificate CRUD + coverage + expiring
- /use-tax — use-tax entries + reconciliation
- /audit — run audit, audit-run history
- /findings — ledger, status transitions, re-audit
- /statute — SOL rules, expiring queue
- /claims — claim CRUD, lifecycle, attach findings
- /claim-activity — correspondence/activity log
- /offenders — repeat-offender dashboard data
- /analytics — KPIs and breakdowns
- /reports — report generation/export
- /alerts — alert feed
- /notifications — per-user notifications
- /saved-views — saved filters
- /activity — activity log
- /seed — sample-data seeder
- /billing — plan/checkout/portal/webhook

## Frontend Pages (~24)

Public:
1. `/` — landing (static)
2. `/auth/sign-in`
3. `/auth/sign-up`
4. `/pricing`

Dashboard:
5. `/dashboard` — recovery overview
6. `/dashboard/invoices` — invoice list + import
7. `/dashboard/invoices/[id]` — invoice detail with line audit results
8. `/dashboard/vendors` — vendor registry
9. `/dashboard/vendors/[id]` — vendor detail
10. `/dashboard/offenders` — repeat-offender dashboard
11. `/dashboard/certificates` — exemption-certificate registry
12. `/dashboard/jurisdictions` — jurisdictions + rate tables
13. `/dashboard/categories` — product-category taxability matrix
14. `/dashboard/use-tax` — use-tax reconciliation
15. `/dashboard/audit` — audit runs
16. `/dashboard/findings` — findings ledger
17. `/dashboard/statute` — statute-of-limitations queue/calendar
18. `/dashboard/claims` — refund-claim list
19. `/dashboard/claims/[id]` — claim detail + activity
20. `/dashboard/analytics` — recovery analytics
21. `/dashboard/reports` — reports & exports
22. `/dashboard/notifications` — notification feed
23. `/dashboard/saved-views` — saved views
24. `/dashboard/settings` — workspace/profile + billing + seed
