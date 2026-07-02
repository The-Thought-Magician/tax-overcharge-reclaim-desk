'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const included = [
  'Unlimited workspaces and vendors',
  'Invoice ingestion (manual + CSV/JSON import)',
  'Tax-line taxability auditor with rule trace',
  'Jurisdiction rate-validation engine',
  'Use-tax double-payment reconciliation',
  'Exemption-certificate registry + expiry alerts',
  'Statute-of-limitations clock and expiring queue',
  'Refund-claim pipeline with activity log',
  'Repeat-offender ranking and vendor scorecards',
  'Recovery analytics, reports, and CSV export',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    api
      .getBillingPlan()
      .then((res) => {
        if (active) setStripeEnabled(Boolean(res?.stripeEnabled))
      })
      .catch(() => {
        if (active) setStripeEnabled(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-black tracking-tight text-orange-400">TaxOverchargeReclaimDesk</Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-neutral-300 hover:text-white text-sm">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, flat pricing</h1>
        <p className="mt-4 text-neutral-400">
          No contingency cut. You keep the recovered cash. Every feature is free while we build.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-orange-800 bg-neutral-900 p-8 text-left">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-orange-300">Free</h2>
            <span className="rounded-full border border-orange-800 bg-orange-950 px-3 py-1 text-xs font-medium text-orange-300">
              All features included
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-black">$0</span>
            <span className="text-neutral-500">/ month</span>
          </div>
          <p className="mt-2 text-sm text-neutral-400">
            Full access to the reverse sales and use-tax recovery platform.
          </p>
          <ul className="mt-6 space-y-3">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-neutral-300">
                <span className="mt-0.5 text-orange-400">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/auth/sign-up"
            className="mt-8 block rounded-lg bg-orange-600 px-6 py-3 text-center font-semibold text-white hover:bg-orange-500"
          >
            Get started free
          </Link>
          <p className="mt-4 text-center text-xs text-neutral-500">
            {stripeEnabled === null
              ? 'Loading plan details…'
              : stripeEnabled
                ? 'Paid plans available — manage billing from Settings after signing in.'
                : 'Billing is not enabled yet. Everything is free today.'}
          </p>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-10 text-center text-sm text-neutral-600">
        <p>TaxOverchargeReclaimDesk</p>
      </footer>
    </main>
  )
}
