import Link from 'next/link'

const features = [
  {
    title: 'Tax-Line Auditor',
    body: 'Every taxed line is checked against product category, ship-to jurisdiction, and your exemption certificates. Flags tax charged despite a valid exemption or on non-taxable categories, with a deterministic rule trace.',
  },
  {
    title: 'Rate-Validation Engine',
    body: 'Compares the rate charged against the correct state, county, city, and district combined rate for the ship-to and effective date. Surfaces over-rated and wrong-jurisdiction charges with the exact dollar delta.',
  },
  {
    title: 'Use-Tax Reconciliation',
    body: 'Matches your self-assessed use-tax accruals to vendor-charged tax on the same purchase, flagging double payments and suggesting net use-tax-due adjustments.',
  },
  {
    title: 'Exemption-Certificate Registry',
    body: 'Track resale, manufacturing, R&D, nonprofit, government, and direct-pay certificates. Link them to vendors and categories, watch expirations, and see which purchases each certificate should have exempted.',
  },
  {
    title: 'Statute-of-Limitations Clock',
    body: 'Per-state SOL windows compute a deadline on every finding. An expiring-soon queue and calendar make sure refundable money is never lost to a lapsed filing date.',
  },
  {
    title: 'Refund-Claim Pipeline',
    body: 'Convert findings into filed claims, attach supporting findings, log activity, and track expected versus recovered cash through identified, in-claim, claimed, and recovered states.',
  },
]

const steps = [
  { n: '1', title: 'Ingest invoices', body: 'Import already-paid vendor invoices and lines by CSV or JSON, or enter them by hand.' },
  { n: '2', title: 'Run the audit', body: 'The taxability and rate-validation engines scan every line against rate tables and your certificate registry.' },
  { n: '3', title: 'Work the findings', body: 'Review overcharges in the ledger, then bundle them into refund claims before the statute clock expires.' },
  { n: '4', title: 'Recover the cash', body: 'File claims, track recovered amounts, and keep the recovery minus a flat fee instead of a 25-35% contingency.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-black tracking-tight text-teal-400">TaxOverchargeReclaimDesk</span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-slate-300 hover:text-white text-sm">Pricing</Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-teal-800 bg-teal-950 px-3 py-1 text-xs font-medium text-teal-300">
          Reverse sales &amp; use-tax recovery
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight">
          Claw back the sales tax your vendors overcharged.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-slate-400">
          TaxOverchargeReclaimDesk audits already-paid vendor invoices line by line against jurisdiction rate tables and
          your exemption certificates, surfaces every overcharge, and drives each finding through a statute-aware refund
          claim to recovered cash. A self-serve alternative to contingency reverse-audit firms.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-lg font-semibold">
            Start recovering
          </Link>
          <Link href="/auth/sign-in" className="border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-center text-2xl font-bold">The money is leaking in four ways</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
            Multi-state companies routinely overpay because vendors tax exempt purchases, apply the wrong jurisdiction
            rate, tax non-taxable freight or services, and self-assessed use tax gets double-paid.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600/20 text-sm font-bold text-teal-300">
                  {s.n}
                </div>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-center text-2xl font-bold">Everything you need to recover overpaid tax</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold text-teal-300">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-black">Stop paying 25-35% to a contingency firm.</h2>
          <p className="mt-4 text-slate-400">
            Keep the recovery minus a flat SaaS fee. Every feature is free while we build.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-lg font-semibold">
              Create your workspace
            </Link>
            <Link href="/pricing" className="border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>TaxOverchargeReclaimDesk</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <Link href="/pricing" className="hover:text-slate-400">Pricing</Link>
          <Link href="/auth/sign-in" className="hover:text-slate-400">Sign In</Link>
          <Link href="/auth/sign-up" className="hover:text-slate-400">Sign Up</Link>
        </div>
      </footer>
    </main>
  )
}
