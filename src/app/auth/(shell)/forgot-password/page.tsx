'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SimpleAuthPageChrome } from '../../_components/AuthPageChrome'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <SimpleAuthPageChrome footer={false}>
        <div className="w-full max-w-md">
          <div className="glass-dark rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
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
            <p className="text-[var(--muted)] mb-6">
              If an account exists for <strong className="text-[var(--foreground)]">{email}</strong>,
              you&apos;ll receive a password reset link shortly.
            </p>
            <Link
              href="/auth/sign-in"
              className="inline-block px-6 py-3 bg-[var(--foreground)] text-[var(--background)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </SimpleAuthPageChrome>
    )
  }

  return (
    <SimpleAuthPageChrome>
      <div className="w-full max-w-md">
        <div className="glass-dark rounded-2xl p-8">
          <h1 className="text-2xl font-serif text-center mb-2">Forgot password?</h1>
          <p className="text-sm text-[var(--muted)] text-center mb-8">
            Enter your email and we&apos;ll send you a reset link
          </p>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
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
                  className="w-full px-4 py-3 bg-white border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)] focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-[var(--foreground)] text-[var(--background)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[var(--muted)]">
              Remember your password?{' '}
              <Link
                href="/auth/sign-in"
                className="text-[var(--foreground)] hover:underline font-medium"
              >
                Sign in
              </Link>
            </p>
        </div>
      </div>
    </SimpleAuthPageChrome>
  )
}
