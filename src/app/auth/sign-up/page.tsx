'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LandingAuthBoundary, LandingAuthPageChrome } from '../_components/AuthPageChrome'
import { sanitizeClientAuthRedirect } from '@/shared/auth/auth-redirect'
import {
  persistMobilePkceChallengeFromUrl,
  resolveCodeChallengeForSso,
} from '@/shared/auth/mobile-auth-client'
import {
  marketingAuthCard,
  marketingAuthMuted,
  marketingDividerLabel,
  marketingPrimaryField,
  marketingSsoButton,
  marketingSubmitButton,
} from '@/features/landing/lib/landingPageStyles'
import { DEFAULT_OVERLAY_CAPABILITIES, type CapabilityCheck } from '@overlay/app-core'
import { SsoProviderIcon, useAuthUiOptions } from '../_components/useAuthUiOptions'

function SignUpContent() {
  const card = marketingAuthCard()
  const muted = marketingAuthMuted()
  const sso = marketingSsoButton()
  const field = marketingPrimaryField()
  const submit = marketingSubmitButton()
  const divLabel = marketingDividerLabel()
  const labelText = 'text-[var(--foreground)]'
  const createLink = 'text-[var(--foreground)] hover:underline font-medium'
  const searchParams = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [verificationTicket, setVerificationTicket] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null)
  const authUiOptions = useAuthUiOptions()

  // Get redirect URL from params (for desktop app auth)
  const redirectUrl = sanitizeClientAuthRedirect(searchParams?.get('redirect'))

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams)
  }, [searchParams])

  useEffect(() => {
    let active = true
    void fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      })
      .then((payload) => {
        if (!active) return
        const capabilities = {
          ...DEFAULT_OVERLAY_CAPABILITIES,
          ...((payload?.capabilities ?? {}) as Partial<CapabilityCheck>),
        }
        setSsoEnabled(capabilities.sso)
      })
      .catch(() => {
        if (active) setSsoEnabled(true)
      })

    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Sign up failed')
        return
      }

      // Store userId for verification and show verification UI
      if (typeof data.verificationTicket === 'string' && data.verificationTicket.trim()) {
        setVerificationTicket(data.verificationTicket)
      }
      setSuccess(true)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!verificationTicket || !verificationCode) return

    setVerifying(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: verificationTicket, code: verificationCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid verification code')
        return
      }

      setVerified(true)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setVerifying(false)
    }
  }

  const handleResendCode = async () => {
    if (!verificationTicket) return

    setResending(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: verificationTicket, action: 'resend' }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to resend code')
        return
      }

      // Show success briefly
      setError(null)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setResending(false)
    }
  }

  const handleSSO = (provider: string) => {
    if (!ssoEnabled) return
    setSsoLoading(provider)
    const codeChallenge = resolveCodeChallengeForSso(searchParams)
    const pkceParam = codeChallenge
      ? `&codeChallenge=${encodeURIComponent(codeChallenge)}`
      : ''
    const ssoUrl = `/api/auth/sso/${provider}?redirect=${encodeURIComponent(redirectUrl)}${pkceParam}`
    window.location.href = ssoUrl
  }
  const ssoProviders = authUiOptions?.ssoProviders ?? []
  const showSso = Boolean(ssoEnabled && authUiOptions?.supportsSso && ssoProviders.length > 0)
  const showPasswordSignUp = authUiOptions?.supportsPasswordSignUp === true

  if (success) {
    // Show verified success screen
    if (verified) {
      return (
        <LandingAuthPageChrome footer={false}>
          <div className="w-full max-w-md">
            <div className={`${card} text-center`}>
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
                <h1 className={`text-2xl font-serif mb-2 ${labelText}`}>Email verified!</h1>
                <p className={`mb-6 ${muted}`}>
                  Your account has been verified. You can now sign in.
                </p>
                <Link
                  href={`/auth/sign-in${redirectUrl !== '/account' ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
                  className="inline-block rounded-xl bg-[var(--foreground)] px-8 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
                >
                  Sign in
                </Link>
            </div>
          </div>
        </LandingAuthPageChrome>
      )
    }

    // Show verification code input
    return (
      <LandingAuthPageChrome footer={false}>
        <div className="w-full max-w-md">
          <div className={`${card} text-center`}>
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-blue-600"
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
              <h1 className={`text-2xl font-serif mb-2 ${labelText}`}>Check your email</h1>
              <p className={`mb-6 ${muted}`}>
                We&apos;ve sent a verification code to{' '}
                <strong className={labelText}>{email}</strong>.
                Enter the code below to verify your account.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleVerifyCode} className="space-y-4">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  className={`${field} text-center text-lg font-mono tracking-widest`}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={verifying || verificationCode.length < 6}
                  className={submit}
                >
                  {verifying ? 'Verifying...' : 'Verify email'}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-(--muted)">
                <span>Didn&apos;t receive the code?</span>
                <button
                  onClick={handleResendCode}
                  disabled={resending}
                  className="text-foreground hover:underline font-medium disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Resend'}
                </button>
              </div>

              <div className="mt-6 pt-4 border-t border-(--border)">
                <Link
                  href="/auth/sign-in"
                  className="text-sm text-(--muted) hover:text-foreground"
                >
                  Back to sign in
                </Link>
              </div>
            </div>
        </div>
      </LandingAuthPageChrome>
    )
  }

  return (
    <LandingAuthPageChrome
      footerClassName="relative z-10 mt-auto flex justify-center border-t border-[var(--border)] px-8 py-6 text-sm text-[var(--muted)] sm:justify-start"
    >
      <div className="w-full max-w-md">
        <div className={card}>
            <h1 className={`text-2xl font-serif text-center mb-2 ${labelText}`}>
              {showPasswordSignUp ? 'Create your account' : 'Sign in with SSO'}
            </h1>
            <p className={`text-sm text-center mb-8 ${muted}`}>
              {showPasswordSignUp ? 'Start your journey with overlay' : 'Use your organization account to continue'}
            </p>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
                {error}
              </div>
            )}

            {/* SSO Buttons */}
            {showSso ? (
            <div className="space-y-3 mb-6">
              {ssoProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSSO(provider.id)}
                  disabled={ssoLoading !== null}
                  className={sso}
                >
                  <SsoProviderIcon provider={provider.id} />
                  {ssoLoading === provider.id ? 'Redirecting...' : provider.label}
                </button>
              ))}
            </div>
            ) : null}

            {/* Divider */}
            {showSso && showPasswordSignUp ? (
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--border)]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className={divLabel}>or create with email</span>
              </div>
            </div>
            ) : null}

            {/* Email/Password Form */}
            {showPasswordSignUp ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className={`block text-sm font-medium mb-2 ${labelText}`}>
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={field}
                    placeholder="John"
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className={`block text-sm font-medium mb-2 ${labelText}`}>
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={field}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className={`block text-sm font-medium mb-2 ${labelText}`}>
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

              <div>
                <label htmlFor="password" className={`block text-sm font-medium mb-2 ${labelText}`}>
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className={field}
                  placeholder="••••••••"
                />
                <p className={`mt-1 text-xs ${muted}`}>
                  Must be at least 8 characters
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className={`block text-sm font-medium mb-2 ${labelText}`}>
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className={field}
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" disabled={loading} className={submit}>
                {loading ? 'Creating account...' : 'Create account'}
              </button>
            </form>
            ) : null}

            {/* Terms */}
            {showPasswordSignUp ? (
            <p className={`mt-4 text-center text-xs ${muted}`}>
              By creating an account, you agree to our{' '}
              <Link href="/terms" className="underline hover:text-[var(--foreground)]">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="underline hover:text-[var(--foreground)]">
                Privacy Policy
              </Link>
            </p>
            ) : null}

            <p className={`mt-6 text-center text-sm ${muted}`}>
              Already have an account?{' '}
              <Link
                href={`/auth/sign-in${redirectUrl !== '/account' ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`}
                className={createLink}
              >
                Sign in
              </Link>
            </p>
        </div>
      </div>
    </LandingAuthPageChrome>
  )
}

export default function SignUpPage() {
  return (
    <LandingAuthBoundary>
      <SignUpContent />
    </LandingAuthBoundary>
  )
}
