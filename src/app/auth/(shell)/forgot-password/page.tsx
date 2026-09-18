'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LandingAuthPageChrome } from '../../_components/AuthPageChrome'
import {
  marketingAuthMuted,
  marketingPrimaryField,
  marketingSubmitButton,
} from '@/features/landing/lib/landingPageStyles'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const muted = marketingAuthMuted()
  const field = marketingPrimaryField()
  const submit = marketingSubmitButton()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (data.success) {
        setSent(true)
      } else {
        setError(data.error || 'Failed to send reset email')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <LandingAuthPageChrome>
        <div>
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
            <svg
              className="w-8 h-8 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-serif mb-2">Check your email</h1>
          <p className={`mb-8 text-sm ${muted}`}>
            If an account exists for <strong className="text-[var(--foreground)]">{email}</strong>,
            you&apos;ll receive a password reset link shortly.
          </p>
          <Link
            href="/auth/sign-in"
            className={`${submit} inline-block text-center`}
          >
            Back to sign in
          </Link>
        </div>
      </LandingAuthPageChrome>
    )
  }

  return (
    <LandingAuthPageChrome>
      <div>
        <h1 className="text-2xl font-serif mb-2">Forgot password?</h1>
        <p className={`text-sm mb-8 ${muted}`}>
          Enter your email and we&apos;ll send you a reset link
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={field}
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={submit}
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className={`mt-8 text-center text-sm ${muted}`}>
          Remember your password?{' '}
          <Link
            href="/auth/sign-in"
            className="text-[var(--foreground)] hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </LandingAuthPageChrome>
  )
}
