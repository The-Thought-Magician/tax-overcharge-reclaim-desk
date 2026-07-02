import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'TaxOverchargeReclaimDesk',
  description: 'Reverse sales and use-tax recovery. Audit paid vendor invoices, surface overcharges, and drive refund claims to recovered cash.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
