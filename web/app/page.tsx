import Link from 'next/link'

const features = [
  {
    title: 'Tax-Line Auditor',
    body: 'Every taxed line is checked against product category, ship-to jurisdiction, and your exemption certificates on file. Tax charged despite a valid exemption, or on a non-taxable category, is flagged with a deterministic rule trace suitable for an audit workpaper.',
  },
  {
    title: 'Rate-Validation Engine',
    body: 'The rate charged is reconciled against the correct combined state, county, city, and district rate for the ship-to address as of the invoice date. Over-rated and wrong-jurisdiction charges are surfaced with the exact dollar delta and citation.',
  },
  {
    title: 'Use-Tax Reconciliation',
    body: 'Self-assessed use-tax accruals are matched to vendor-charged tax on the same purchase. Double payments are flagged for reversal, with the net use-tax-due adjustment computed automatically.',
  },
  {
    title: 'Exemption-Certificate Registry',
    body: 'Maintain resale, manufacturing, R&D, nonprofit, government, and direct-pay certificates in one system of record. Certificates are linked to vendors and product categories, with expiration tracking and a record of which purchases each one should have exempted.',
  },
  {
    title: 'Statute-of-Limitations Clock',
    body: 'Every finding carries a computed deadline based on the applicable state statute-of-limitations window. An expiring-soon queue and calendar view exist to ensure refundable money is not forfeited to a lapsed filing date.',
  },
  {
    title: 'Refund-Claim Pipeline',
    body: 'Findings are converted into filed claims with supporting documentation attached and an activity log retained. Expected versus recovered amounts are tracked through identified, in-claim, claimed, and recovered status.',
  },
]

const steps = [
  { n: '1', title: 'Ingest invoices', body: 'Import already-paid vendor invoices and line items by CSV or JSON, or enter them directly.' },
  { n: '2', title: 'Run the audit', body: 'The taxability and rate-validation engines examine every line against rate tables and your certificate registry, with no manual sampling.' },
  { n: '3', title: 'Work the findings', body: 'Review each overcharge in the ledger, verify the supporting basis, and assemble refund claims ahead of the statute deadline.' },
  { n: '4', title: 'Recover the cash', body: 'File claims, track recovered amounts against expected recovery, and retain the full documentation trail for your records.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-orange-400">TaxOverchargeReclaimDesk</span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-neutral-300 hover:text-white text-sm">Pricing</Link>
          <Link href="/auth/sign-in" className="text-neutral-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-full text-sm font-semibold">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-orange-800 bg-orange-950 px-3 py-1 text-xs font-medium text-orange-300">
          Reverse sales &amp; use-tax recovery, documented for audit
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight">
          A systematic control for sales and use-tax overcharges on invoices you have already paid.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-neutral-400">
          TaxOverchargeReclaimDesk reviews every taxed line on paid vendor invoices against jurisdiction rate tables and
          your exemption-certificate registry, records the basis for each finding, and moves each one through a
          statute-aware refund-claim workflow to recovered cash. Built for teams who need the recovery process
          defensible, not just fast.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-3 rounded-full font-semibold">
            Start recovering
          </Link>
          <Link href="/auth/sign-in" className="border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 px-6 py-3 rounded-full font-semibold">
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-t border-neutral-800 bg-neutral-900/30">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-center text-2xl font-bold">Four documented sources of overpayment</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-neutral-400">
            Multi-state companies routinely overpay because vendors tax exempt purchases, apply the wrong jurisdiction
            rate, tax non-taxable freight or services, or because self-assessed use tax is double-paid alongside a
            vendor-charged amount. None of this is intentional, and none of it self-corrects without review.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600/20 text-sm font-bold text-orange-300">
                  {s.n}
                </div>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-neutral-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-center text-2xl font-bold">A recovery program your finance and tax leadership can stand behind</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
              <h3 className="text-lg font-semibold text-orange-300">{f.title}</h3>
              <p className="mt-2 text-sm text-neutral-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-neutral-800">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold">Retain the recovery instead of ceding 25-35% to a contingency firm.</h2>
          <p className="mt-4 text-neutral-400">
            The workspace runs on a flat SaaS fee, with the full audit trail retained under your control. Every
            feature is available at no charge while the platform is in build.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-3 rounded-full font-semibold">
              Create your workspace
            </Link>
            <Link href="/pricing" className="border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 px-6 py-3 rounded-full font-semibold">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-10 text-center text-sm text-neutral-600">
        <p>TaxOverchargeReclaimDesk</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <Link href="/pricing" className="hover:text-neutral-400">Pricing</Link>
          <Link href="/auth/sign-in" className="hover:text-neutral-400">Sign In</Link>
          <Link href="/auth/sign-up" className="hover:text-neutral-400">Sign Up</Link>
        </div>
      </footer>
    </main>
  )
}
