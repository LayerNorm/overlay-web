'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  clearStoredMobilePkceChallenge,
  getStoredMobilePkceChallenge,
} from '@/shared/auth/mobile-auth-client'

export default function MobileCompletePage() {
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function transferSession() {
      try {
        const codeChallenge = getStoredMobilePkceChallenge()
        if (!codeChallenge) {
          throw new Error(
            'Missing mobile auth handshake. Open Overlay on your phone and start sign-in from the app.',
          )
        }

        const response = await fetch('/api/auth/desktop-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codeChallenge }),
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok || typeof data.deepLink !== 'string') {
          throw new Error(data.error || 'Failed to hand off session to the app')
        }

        clearStoredMobilePkceChallenge()

        if (!cancelled) {
          window.location.replace(data.deepLink)
        }
      } catch (nextError) {
        if (!cancelled) {
          setStatus('error')
          setError(nextError instanceof Error ? nextError.message : 'Failed to open Overlay')
        }
      }
    }

    transferSession()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen gradient-bg flex items-center justify-center px-6 py-12">
      <div className="glass-dark rounded-2xl p-8 w-full max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)] mb-3">
          Mobile Auth
        </p>
        <h1 className="text-2xl font-serif mb-3">
          {status === 'loading' ? 'Opening Overlay' : 'Could not open the app'}
        </h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          {status === 'loading'
            ? 'Your session is being transferred back into the mobile app.'
            : error || 'Return to sign in and try again.'}
        </p>

        {status === 'error' ? (
          <div className="flex flex-col gap-3">
            <Link
              href="/auth/sign-in?redirect=%2Fauth%2Fmobile-complete&force=true"
              className="w-full py-3 px-4 bg-[var(--foreground)] text-[var(--background)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Try again
            </Link>
            <Link
              href="/app/settings?section=account"
              className="w-full py-3 px-4 border border-[var(--border)] rounded-xl text-sm font-medium hover:bg-white/5 transition-colors"
            >
              Go to account
            </Link>
          </div>
        ) : (
          <div className="text-sm text-[var(--muted)]">You can return here if the app does not open automatically.</div>
        )}
      </div>
    </main>
  )
}
