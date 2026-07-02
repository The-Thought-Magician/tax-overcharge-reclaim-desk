'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    title: 'Audit',
    items: [
      { label: 'Invoices', href: '/dashboard/invoices' },
      { label: 'Audit Runs', href: '/dashboard/audit' },
      { label: 'Findings', href: '/dashboard/findings' },
      { label: 'Use-Tax', href: '/dashboard/use-tax' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { label: 'Claims', href: '/dashboard/claims' },
      { label: 'Statute Clock', href: '/dashboard/statute' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Reference Data',
    items: [
      { label: 'Vendors', href: '/dashboard/vendors' },
      { label: 'Repeat Offenders', href: '/dashboard/offenders' },
      { label: 'Certificates', href: '/dashboard/certificates' },
      { label: 'Jurisdictions', href: '/dashboard/jurisdictions' },
      { label: 'Categories', href: '/dashboard/categories' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Saved Views', href: '/dashboard/saved-views' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!active) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      setChecking(false)
    })()
    return () => {
      active = false
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex items-center gap-3 text-neutral-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-orange-400" />
          Loading workspace…
        </div>
      </div>
    )
  }

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-neutral-800/80 px-6 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-sm font-bold text-white shadow-[0_0_0_3px_rgba(234,88,12,0.15)]">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">TaxOverchargeReclaimDesk</span>
      </div>
      <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-6">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-orange-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-neutral-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-neutral-800/80 bg-neutral-900/60 lg:block">
        {SidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-neutral-800 bg-neutral-900">
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-950/80 px-4 py-3.5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-neutral-300">Recovery Desk</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/notifications"
              className="rounded-full px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Alerts
            </Link>
            <button
              onClick={signOut}
              className="rounded-full border border-neutral-700 bg-neutral-800 px-3.5 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-700"
            >
              Sign Out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
