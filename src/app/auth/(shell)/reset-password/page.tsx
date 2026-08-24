'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthLoadingScreen, SimpleAuthPageChrome } from '../../_components/AuthPageChrome'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const token = searchParams?.get('token') ?? null

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset link.')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await response.json()

      if (data.success) {
        setSuccess(true)
      } else {
        setError(data.error || 'Failed to reset password')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-serif mb-2">Password reset!</h1>
            <p className="text-[var(--muted)] mb-6">
              Your password has been successfully reset. You can now sign in with your new password.
            </p>
            <Link
              href="/auth/sign-in"
              className="inline-block px-6 py-3 bg-[var(--foreground)] text-[var(--background)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Sign in
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
          <h1 className="text-2xl font-serif text-center mb-2">Reset your password</h1>
          <p className="text-sm text-[var(--muted)] text-center mb-8">
            Enter your new password below
          </p>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
                {error}
                {!token && (
                  <Link
                    href="/auth/forgot-password"
                    className="block mt-2 text-red-600 hover:text-red-700 underline"
                  >
                    Request a new reset link
                  </Link>
                )}
              </div>
            )}

            {token && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-2">
                    New password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 bg-white border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)] focus:border-transparent"
                    placeholder="••••••••"
                  />
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Must be at least 8 characters
                  </p>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                    Confirm new password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)] focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-[var(--foreground)] text-[var(--background)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? 'Resetting...' : 'Reset password'}
                </button>
              </form>
            )}

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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen tone="simple" />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
