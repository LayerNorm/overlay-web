import type { Metadata } from 'next'
import { connection } from 'next/server'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

/**
 * Auth pages must render per request, never statically prerender: the
 * nonce-based CSP only stamps script nonces during dynamic rendering, and a
 * static prerender ships nonce-less flight scripts that the browser blocks —
 * killing hydration and sticking visitors on "Loading..." forever.
 * (`export const dynamic` is forbidden with `cacheComponents`, so request
 * time is forced with `connection()` instead.)
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await connection()
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {children}
    </div>
  )
}
