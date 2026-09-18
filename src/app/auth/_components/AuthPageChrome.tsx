'use client'

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { AuthBoundary } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'

function AuthBrandMark({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/overlay-logo.png" alt="" className="h-7 w-7" />
      <span className="font-serif text-lg tracking-tight text-[var(--foreground)]">overlay</span>
    </Link>
  )
}

/**
 * Split auth chrome: a quiet brand panel on the left (desktop only) and a flat
 * form column on the right. Children render the heading + form content inside
 * the column — no floating card.
 */
export function LandingAuthPageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <aside className="relative hidden w-[45%] flex-col justify-between overflow-hidden border-r border-[var(--border)] bg-[var(--surface-subtle)] px-12 py-12 lg:flex xl:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_50%_at_50%_0%,var(--surface-muted),transparent)]"
        />
        <AuthBrandMark className="relative" />
        <div className="relative">
          <p className="max-w-md font-serif text-3xl leading-snug text-[var(--foreground)] xl:text-4xl">
            The control panel for your AI workforce.
          </p>
          <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted)]">
            Create, deploy, and manage your agents in one workspace — or bring
            the ones you already trust.
          </p>
        </div>
        <div className="relative flex items-center gap-5 text-xs text-[var(--muted-light)]">
          <Link href="/terms" className="transition-colors hover:text-[var(--foreground)]">
            Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-[var(--foreground)]">
            Privacy
          </Link>
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-16 sm:px-10">
        <div className="my-auto w-full max-w-sm">
          <AuthBrandMark className="mb-10 justify-center lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  )
}

export function AuthLoadingScreen({
  tone = 'landing',
}: {
  tone?: 'landing' | 'simple'
}) {
  const spinnerClass =
    tone === 'simple'
      ? 'w-8 h-8 border-2 border-[var(--foreground)] border-t-transparent rounded-full animate-spin mx-auto'
      : 'mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent'
  const textClass = 'mt-4 text-[var(--muted)]'

  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="relative z-10 text-center">
        <div className={spinnerClass} />
        <p className={textClass}>Loading...</p>
      </div>
    </div>
  )
}

export function LandingAuthBoundary({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <Suspense fallback={<AuthLoadingScreen tone="landing" />}>
          {children}
        </Suspense>
      </LandingThemeProvider>
    </AuthBoundary>
  )
}
