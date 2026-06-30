import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TaxOverchargeReclaimDesk',
  description: 'Reverse sales and use-tax recovery. Audit paid vendor invoices, surface overcharges, and drive refund claims to recovered cash.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
