'use client'

import { Suspense, type ReactNode } from 'react'
import { AuthBoundary } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'

type AuthPageChromeProps = {
  children: ReactNode
  footer?: boolean
}

export function SimpleAuthPageChrome({ children }: AuthPageChromeProps) {
  return (
    <div className="flex min-h-full w-full items-center justify-center bg-[var(--background)] px-4 py-10 text-[var(--foreground)] md:px-8">
      <main className="w-full">
        {children}
      </main>
    </div>
  )
}

type LandingAuthPageChromeProps = {
  children: ReactNode
  footerClassName?: string
  mainClassName?: string
  footer?: boolean
}

export function LandingAuthPageChrome({ children }: LandingAuthPageChromeProps) {
  return (
    <div className="flex min-h-full w-full items-center justify-center bg-[var(--background)] px-4 py-10 text-[var(--foreground)] md:px-8">
      <main className="w-full">{children}</main>
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
