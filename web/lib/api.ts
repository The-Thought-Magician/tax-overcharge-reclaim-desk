// Same-origin relative calls to /api/proxy/* — the proxy route injects X-User-Id.
// Path after /api/proxy/ maps 1:1 to the backend path after /api/v1/.

async function get(path: string) {
  const r = await fetch(`/api/proxy/${path}`)
  if (!r.ok) throw new Error((await r.text()) || `GET ${path} failed`)
  return r.json()
}

async function send(method: string, path: string, data?: unknown) {
  const r = await fetch(`/api/proxy/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error((await r.text()) || `${method} ${path} failed`)
  return r.json()
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  getWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (data: unknown) => send('POST', 'workspaces', data),
  updateWorkspace: (id: string, data: unknown) => send('PUT', `workspaces/${id}`, data),
  getWorkspaceMembers: (id: string) => get(`workspaces/${id}/members`),
  addWorkspaceMember: (id: string, data: unknown) => send('POST', `workspaces/${id}/members`, data),

  // Vendors
  getVendors: (workspaceId: string) => get(`vendors${qs({ workspace_id: workspaceId })}`),
  getVendor: (id: string) => get(`vendors/${id}`),
  createVendor: (data: unknown) => send('POST', 'vendors', data),
  updateVendor: (id: string, data: unknown) => send('PUT', `vendors/${id}`, data),
  deleteVendor: (id: string) => send('DELETE', `vendors/${id}`),

  // Invoices
  getInvoices: (workspaceId: string, status?: string) =>
    get(`invoices${qs({ workspace_id: workspaceId, status })}`),
  getInvoice: (id: string) => get(`invoices/${id}`),
  createInvoice: (data: unknown) => send('POST', 'invoices', data),
  updateInvoice: (id: string, data: unknown) => send('PUT', `invoices/${id}`, data),
  deleteInvoice: (id: string) => send('DELETE', `invoices/${id}`),
  importInvoices: (data: unknown) => send('POST', 'invoices/import', data),
  checkDuplicateInvoices: (data: unknown) => send('POST', 'invoices/check-duplicates', data),

  // Invoice lines
  getInvoiceLines: (invoiceId: string) => get(`invoice-lines${qs({ invoice_id: invoiceId })}`),
  updateInvoiceLine: (id: string, data: unknown) => send('PUT', `invoice-lines/${id}`, data),

  // Jurisdictions
  getJurisdictions: (workspaceId: string) => get(`jurisdictions${qs({ workspace_id: workspaceId })}`),
  getJurisdiction: (id: string) => get(`jurisdictions/${id}`),
  createJurisdiction: (data: unknown) => send('POST', 'jurisdictions', data),
  updateJurisdiction: (id: string, data: unknown) => send('PUT', `jurisdictions/${id}`, data),
  lookupJurisdiction: (params: { state?: string; county?: string; city?: string }) =>
    get(`jurisdictions/lookup${qs({ state: params.state, county: params.county, city: params.city })}`),

  // Rates
  getRates: (jurisdictionId: string) => get(`rates${qs({ jurisdiction_id: jurisdictionId })}`),
  createRate: (data: unknown) => send('POST', 'rates', data),
  updateRate: (id: string, data: unknown) => send('PUT', `rates/${id}`, data),
  deleteRate: (id: string) => send('DELETE', `rates/${id}`),

  // Categories
  getCategories: (workspaceId: string) => get(`categories${qs({ workspace_id: workspaceId })}`),
  createCategory: (data: unknown) => send('POST', 'categories', data),
  updateCategory: (id: string, data: unknown) => send('PUT', `categories/${id}`, data),
  deleteCategory: (id: string) => send('DELETE', `categories/${id}`),

  // Taxability
  getTaxabilityRules: (params: { workspaceId?: string; categoryId?: string }) =>
    get(`taxability${qs({ workspace_id: params.workspaceId, category_id: params.categoryId })}`),
  createTaxabilityRule: (data: unknown) => send('POST', 'taxability', data),
  updateTaxabilityRule: (id: string, data: unknown) => send('PUT', `taxability/${id}`, data),
  deleteTaxabilityRule: (id: string) => send('DELETE', `taxability/${id}`),

  // Certificates
  getCertificates: (workspaceId: string) => get(`certificates${qs({ workspace_id: workspaceId })}`),
  getCertificate: (id: string) => get(`certificates/${id}`),
  createCertificate: (data: unknown) => send('POST', 'certificates', data),
  updateCertificate: (id: string, data: unknown) => send('PUT', `certificates/${id}`, data),
  deleteCertificate: (id: string) => send('DELETE', `certificates/${id}`),
  getExpiringCertificates: (workspaceId: string, days?: number) =>
    get(`certificates/expiring${qs({ workspace_id: workspaceId, days })}`),
  addCertificateCoverage: (id: string, data: unknown) => send('POST', `certificates/${id}/coverage`, data),

  // Use-tax
  getUseTaxEntries: (workspaceId: string, period?: string) =>
    get(`use-tax${qs({ workspace_id: workspaceId, period })}`),
  createUseTaxEntry: (data: unknown) => send('POST', 'use-tax', data),
  updateUseTaxEntry: (id: string, data: unknown) => send('PUT', `use-tax/${id}`, data),
  reconcileUseTax: (data: unknown) => send('POST', 'use-tax/reconcile', data),

  // Audit
  getAuditRuns: (workspaceId: string) => get(`audit/runs${qs({ workspace_id: workspaceId })}`),
  getAuditRun: (id: string) => get(`audit/runs/${id}`),
  runAudit: (data: unknown) => send('POST', 'audit/run', data),

  // Findings
  getFindings: (params: { workspaceId: string; type?: string; status?: string }) =>
    get(`findings${qs({ workspace_id: params.workspaceId, type: params.type, status: params.status })}`),
  getFinding: (id: string) => get(`findings/${id}`),
  updateFinding: (id: string, data: unknown) => send('PUT', `findings/${id}`, data),
  reauditFinding: (id: string) => send('POST', `findings/${id}/reaudit`),

  // Statute
  getStatuteRules: (workspaceId: string) => get(`statute/rules${qs({ workspace_id: workspaceId })}`),
  upsertStatuteRule: (data: unknown) => send('POST', 'statute/rules', data),
  getExpiringFindings: (workspaceId: string, days?: number) =>
    get(`statute/expiring${qs({ workspace_id: workspaceId, days })}`),

  // Claims
  getClaims: (workspaceId: string, status?: string) =>
    get(`claims${qs({ workspace_id: workspaceId, status })}`),
  getClaim: (id: string) => get(`claims/${id}`),
  createClaim: (data: unknown) => send('POST', 'claims', data),
  updateClaim: (id: string, data: unknown) => send('PUT', `claims/${id}`, data),
  attachFindingsToClaim: (id: string, data: unknown) => send('POST', `claims/${id}/findings`, data),
  deleteClaim: (id: string) => send('DELETE', `claims/${id}`),

  // Claim activity
  getClaimActivity: (claimId: string) => get(`claim-activity${qs({ claim_id: claimId })}`),
  addClaimActivity: (data: unknown) => send('POST', 'claim-activity', data),

  // Offenders
  getOffenders: (workspaceId: string) => get(`offenders${qs({ workspace_id: workspaceId })}`),

  // Analytics
  getAnalyticsOverview: (workspaceId: string) => get(`analytics/overview${qs({ workspace_id: workspaceId })}`),
  getAnalyticsBreakdown: (workspaceId: string, dimension: string) =>
    get(`analytics/breakdown${qs({ workspace_id: workspaceId, dimension })}`),

  // Reports
  getFindingsReport: (params: { workspaceId: string; type?: string; status?: string }) =>
    get(`reports/findings${qs({ workspace_id: params.workspaceId, type: params.type, status: params.status })}`),
  getRecoveryReport: (workspaceId: string) => get(`reports/recovery${qs({ workspace_id: workspaceId })}`),
  getVendorScorecard: (workspaceId: string) => get(`reports/vendor-scorecard${qs({ workspace_id: workspaceId })}`),

  // Alerts
  getAlerts: (workspaceId: string) => get(`alerts${qs({ workspace_id: workspaceId })}`),

  // Notifications
  getNotifications: (workspaceId: string) => get(`notifications${qs({ workspace_id: workspaceId })}`),
  markNotificationRead: (id: string) => send('POST', `notifications/${id}/read`),
  markAllNotificationsRead: (data: unknown) => send('POST', 'notifications/read-all', data),

  // Saved views
  getSavedViews: (params: { workspaceId: string; entity?: string }) =>
    get(`saved-views${qs({ workspace_id: params.workspaceId, entity: params.entity })}`),
  createSavedView: (data: unknown) => send('POST', 'saved-views', data),
  deleteSavedView: (id: string) => send('DELETE', `saved-views/${id}`),

  // Activity
  getActivityLog: (params: { workspaceId: string; entity_type?: string; entity_id?: string }) =>
    get(`activity${qs({ workspace_id: params.workspaceId, entity_type: params.entity_type, entity_id: params.entity_id })}`),

  // Seed
  seedSampleData: (data: unknown) => send('POST', 'seed/sample', data),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  createCheckout: () => send('POST', 'billing/checkout'),
  createPortal: () => send('POST', 'billing/portal'),
}

export default api
