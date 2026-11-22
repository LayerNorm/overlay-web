'use client'

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { AuthBoundary } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { marketingPrimaryField, marketingSsoButton, marketingSubmitButton } from '@/features/landing/lib/landingPageStyles'

function AuthBrandMark({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex text-(--foreground) ${className}`}>
      <BrandLockup style={{ fontSize: 20 }} />
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
    <div className="flex min-h-screen bg-(--background) text-(--foreground)">
      <aside className="relative hidden w-[45%] flex-col justify-between overflow-hidden border-r border-(--border) bg-(--surface-subtle) px-12 py-12 lg:flex xl:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_50%_at_50%_0%,var(--surface-muted),transparent)]"
        />
        <AuthBrandMark className="relative" />
        <div className="relative">
          <p className="max-w-md font-serif text-3xl leading-snug text-(--foreground) xl:text-4xl">
            The control plane for AI employees.

          </p>
          <p className="mt-5 max-w-sm text-sm leading-6 text-(--muted)">
            Create, deploy, and manage your agents in one workspace — or bring
            the ones you already trust.
          </p>
        </div>
        <div className="relative flex items-center gap-5 text-xs text-(--muted-light)">
          <Link href="/terms" className="transition-colors hover:text-(--foreground)">
            Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-(--foreground)">
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

function Bar({ className }: { className: string }) {
  return <span className={`ui-skeleton-line block rounded-md ${className}`} aria-hidden />
}

/** A zero-width character in the line's font, so a placeholder line is exactly as tall as the real text. */
const STRUT = '\u200b'

/**
 * The sign-in form before it loads, built from the form's own classes: heading, the three sign-in buttons, the
 * divider, the email and password fields and the button. Static labels render for real.
 */
function AuthFormSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="mb-2 flex items-center font-serif text-2xl">{STRUT}<Bar className="h-5 w-40" /></div>
      <div className="mb-8 flex items-center text-sm">{STRUT}<Bar className="h-3 w-56" /></div>
      <div className="mb-6 space-y-3" aria-hidden>
        {[0, 1, 2].map((index) => (
          <div key={index} className={marketingSsoButton()}>{STRUT}<Bar className="h-3 w-40" /></div>
        ))}
      </div>
      <div className="relative my-6" aria-hidden>
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-(--border)" /></div>
        <div className="relative flex justify-center text-xs"><span className="bg-(--background) px-4 text-(--muted)">or continue with email</span></div>
      </div>
      <div className="space-y-4" aria-hidden>
        <div>
          <p className="mb-2 block text-sm font-medium text-(--foreground)">Email</p>
          <div className={marketingPrimaryField()}>{STRUT}</div>
        </div>
        <div>
          <p className="mb-2 block text-sm font-medium text-(--foreground)">Password</p>
          <div className={marketingPrimaryField()}>{STRUT}</div>
        </div>
        <div className={`${marketingSubmitButton()} opacity-50`}>{STRUT}</div>
      </div>
      <div className="mt-8 flex justify-center text-sm" aria-hidden>{STRUT}<Bar className="h-3 w-52" /></div>
    </div>
  )
}

/** Every auth loading stage: the real split chrome around the form skeleton. */
export function AuthLoadingScreen() {
  return (
    <LandingAuthPageChrome>
      <AuthFormSkeleton />
    </LandingAuthPageChrome>
  )
}

export function LandingAuthBoundary({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <Suspense fallback={<AuthLoadingScreen />}>
          {children}
        </Suspense>
      </LandingThemeProvider>
    </AuthBoundary>
  )
}
