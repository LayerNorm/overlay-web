'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LandingAuthPageChrome } from '../../_components/AuthPageChrome'
import { sanitizeClientAuthRedirect } from '@/shared/auth/auth-redirect'
import {
  persistMobilePkceChallengeFromUrl,
  resolveCodeChallengeForSso,
} from '@/shared/auth/mobile-auth-client'
import {
  marketingAuthMuted,
  marketingPrimaryField,
  marketingSsoButton,
  marketingSubmitButton,
} from '@/features/landing/lib/landingPageStyles'
import { SsoProviderIcon } from '../../_components/useAuthUiOptions'
import type { ClientAuthUiOptions } from '../../_components/useAuthUiOptions'
import {
  currentLegalAcceptancePayload,
  LEGAL_DOCUMENTS,
} from '@/shared/legal/legal-documents'

type SignUpResult = { error?: string; verificationTicket?: string }

async function submitSignUpRequest({
  email,
  password,
  firstName,
  lastName,
}: {
  email: string
  password: string
  firstName: string
  lastName: string
}): Promise<SignUpResult> {
  try {
    const response = await fetch('/api/auth/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        firstName,
        lastName,
        ...currentLegalAcceptancePayload(),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { error: data.error || 'Sign up failed' }
    }

    // Store userId for verification and show verification UI
    if (typeof data.verificationTicket === 'string' && data.verificationTicket.trim()) {
      return { verificationTicket: data.verificationTicket }
    }
    return {}
  } catch {
    return { error: 'An unexpected error occurred' }
  }
}

async function postVerifyEmail(
  body: Record<string, string>,
  fallbackError: string,
): Promise<{ error?: string }> {
  try {
    const response = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      return { error: data.error || fallbackError }
    }
    return {}
  } catch {
    return { error: 'An unexpected error occurred' }
  }
}

function VerifiedScreen({
  signInHref,
  labelClass,
  mutedClass,
  submitClass,
}: {
  signInHref: string
  labelClass: string
  mutedClass: string
  submitClass: string
}) {
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
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className={`text-2xl font-serif mb-2 ${labelClass}`}>Email verified!</h1>
        <p className={`mb-8 text-sm ${mutedClass}`}>
          Your account has been verified. You can now sign in.
        </p>
        <Link
          href={signInHref}
          className={`${submitClass} inline-block text-center`}
        >
          Sign in
        </Link>
      </div>
    </LandingAuthPageChrome>
  )
}

function CheckEmailScreen({
  email,
  verificationCode,
  error,
  verifying,
  resending,
  fieldClass,
  labelClass,
  mutedClass,
  submitClass,
  onCodeChange,
  onVerify,
  onResend,
}: {
  email: string
  verificationCode: string
  error: string | null
  verifying: boolean
  resending: boolean
  fieldClass: string
  labelClass: string
  mutedClass: string
  submitClass: string
  onCodeChange: (code: string) => void
  onVerify: (e: React.FormEvent) => void
  onResend: () => void
}) {
  const codeInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    codeInputRef.current?.focus()
  }, [])
  return (
    <LandingAuthPageChrome>
      <div>
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
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
        <h1 className={`text-2xl font-serif mb-2 ${labelClass}`}>Check your email</h1>
        <p className={`mb-8 text-sm ${mutedClass}`}>
          We&apos;ve sent a verification code to{' '}
          <strong className={labelClass}>{email}</strong>.
          Enter the code below to verify your account.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={onVerify} className="space-y-4">
          <input
            type="text"
            aria-label="Verification code"
            value={verificationCode}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="Enter 6-digit code"
            maxLength={6}
            className={`${fieldClass} text-center text-lg font-mono tracking-widest`}
            ref={codeInputRef}
          />
          <button
            type="submit"
            disabled={verifying || verificationCode.length < 6}
            className={submitClass}
          >
            {verifying ? 'Verifying...' : 'Verify email'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
          <span>Didn&apos;t receive the code?</span>
          <button
            onClick={onResend}
            disabled={resending}
            className="text-[var(--foreground)] hover:underline font-medium disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend'}
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-[var(--border)] text-center">
          <Link
            href="/auth/sign-in"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </LandingAuthPageChrome>
  )
}

function SsoProviderButtons({
  providers,
  ssoLoading,
  ssoClass,
  onSelect,
}: {
  providers: ClientAuthUiOptions['ssoProviders']
  ssoLoading: string | null
  ssoClass: string
  onSelect: (provider: string) => void
}) {
  return (
    <div className="space-y-3 mb-6">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onSelect(provider.id)}
          disabled={ssoLoading !== null}
          className={ssoClass}
        >
          <SsoProviderIcon icon={provider.icon} />
          {ssoLoading === provider.id ? 'Redirecting...' : provider.label}
        </button>
      ))}
    </div>
  )
}

function EmailPasswordSignUpForm({
  firstName,
  lastName,
  email,
  password,
  confirmPassword,
  loading,
  fieldClass,
  labelClass,
  mutedClass,
  submitClass,
  onFirstNameChange,
  onLastNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  loading: boolean
  fieldClass: string
  labelClass: string
  mutedClass: string
  submitClass: string
  onFirstNameChange: (value: string) => void
  onLastNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className={`block text-sm font-medium mb-2 ${labelClass}`}>
            First name
          </label>
          <input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            className={fieldClass}
            placeholder="John"
          />
        </div>
        <div>
          <label htmlFor="lastName" className={`block text-sm font-medium mb-2 ${labelClass}`}>
            Last name
          </label>
          <input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => onLastNameChange(e.target.value)}
            className={fieldClass}
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className={`block text-sm font-medium mb-2 ${labelClass}`}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
          className={fieldClass}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className={`block text-sm font-medium mb-2 ${labelClass}`}>
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
          className={fieldClass}
          placeholder="••••••••"
        />
        <p className={`mt-1.5 text-xs ${mutedClass}`}>Must be at least 8 characters</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className={`block text-sm font-medium mb-2 ${labelClass}`}>
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          required
          className={fieldClass}
          placeholder="••••••••"
        />
      </div>

      <button type="submit" disabled={loading} className={submitClass}>
        {loading ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  )
}

function LegalFinePrint() {
  return (
    <p className="mt-8 text-center text-xs leading-5 text-[var(--muted-light)]">
      By continuing, you agree to the{' '}
      <Link href={LEGAL_DOCUMENTS.terms.href} className="underline hover:text-[var(--foreground)]">
        Terms of Service
      </Link>{' '}
      and acknowledge the{' '}
      <Link href={LEGAL_DOCUMENTS.privacy.href} className="underline hover:text-[var(--foreground)]">
        Privacy Policy
      </Link>
      .
    </p>
  )
}

export function SignUpClient({
  authUiOptions,
  ssoEnabled,
}: {
  authUiOptions: ClientAuthUiOptions
  ssoEnabled: boolean
}) {
  const muted = marketingAuthMuted()
  const sso = marketingSsoButton()
  const field = marketingPrimaryField()
  const submit = marketingSubmitButton()
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
  const verificationTicketRef = useRef<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)

  // Get redirect URL from params (for desktop app auth)
  // Auth params intentionally gate first paint; page is client-gated by (shell).
  // react-doctor-disable-next-line react-doctor/no-hydration-branch-on-browser-global
  const redirectUrl = sanitizeClientAuthRedirect(searchParams?.get('redirect'))
  const signInHref = `/auth/sign-in${redirectUrl !== '/account' ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams)
  }, [searchParams])

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

    const result = await submitSignUpRequest({ email, password, firstName, lastName })
    if (result.error) {
      setError(result.error)
    } else {
      if (result.verificationTicket) {
        verificationTicketRef.current = result.verificationTicket
      }
      setSuccess(true)
    }
    setLoading(false)
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (verifying) return
    if (!verificationTicketRef.current || !verificationCode) return

    setVerifying(true)
    setError(null)

    // Guarded by `verifying` at the handler's top.
    // react-doctor-disable-next-line react-doctor/no-async-event-handler-without-reentry-guard
    const result = await postVerifyEmail(
      { ticket: verificationTicketRef.current, code: verificationCode },
      'Invalid verification code',
    )
    if (result.error) {
      setError(result.error)
    } else {
      setVerified(true)
    }
    setVerifying(false)
  }

  const handleResendCode = async () => {
    if (!verificationTicketRef.current || resending) return

    setResending(true)
    setError(null)

    // Guarded by `resending` at the handler's top.
    // react-doctor-disable-next-line react-doctor/no-async-event-handler-without-reentry-guard
    const result = await postVerifyEmail(
      { ticket: verificationTicketRef.current, action: 'resend' },
      'Failed to resend code',
    )
    if (result.error) {
      setError(result.error)
    } else {
      // Show success briefly
      setError(null)
    }
    setResending(false)
  }

  const handleSSO = (provider: string) => {
    if (!ssoEnabled) return
    setSsoLoading(provider)
    const codeChallenge = resolveCodeChallengeForSso(searchParams)
    const pkceParam = codeChallenge
      ? `&codeChallenge=${encodeURIComponent(codeChallenge)}`
      : ''
    const acceptance = currentLegalAcceptancePayload()
    const ssoUrl = `/api/auth/sso/${provider}?redirect=${encodeURIComponent(redirectUrl)}${pkceParam}&intent=signup&acceptedLegalTerms=true&termsVersion=${encodeURIComponent(acceptance.termsVersion)}&privacyVersion=${encodeURIComponent(acceptance.privacyVersion)}`
    window.location.assign(new URL(ssoUrl, window.location.origin).toString())
  }

  const ssoProviders = authUiOptions.ssoProviders
  const showSso = Boolean(ssoEnabled && authUiOptions.supportsSso && ssoProviders.length > 0)
  const showPasswordSignUp = authUiOptions.supportsPasswordSignUp === true

  if (success) {
    // Show verified success screen
    if (verified) {
      return (
        <VerifiedScreen
          signInHref={signInHref}
          labelClass={labelText}
          mutedClass={muted}
          submitClass={submit}
        />
      )
    }

    // Show verification code input
    return (
      <CheckEmailScreen
        email={email}
        verificationCode={verificationCode}
        error={error}
        verifying={verifying}
        resending={resending}
        fieldClass={field}
        labelClass={labelText}
        mutedClass={muted}
        submitClass={submit}
        onCodeChange={setVerificationCode}
        onVerify={handleVerifyCode}
        onResend={handleResendCode}
      />
    )
  }

  return (
    <LandingAuthPageChrome>
      <div>
        <h1 className={`text-2xl font-serif mb-2 ${labelText}`}>
          {showPasswordSignUp ? 'Create your account' : 'Sign in with SSO'}
        </h1>
        <p className={`text-sm mb-8 ${muted}`}>
          {showPasswordSignUp ? 'Start your journey with overlay' : 'Use your organization account to continue'}
        </p>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* SSO Buttons */}
        {showSso ? (
          <SsoProviderButtons
            providers={ssoProviders}
            ssoLoading={ssoLoading}
            ssoClass={sso}
            onSelect={handleSSO}
          />
        ) : null}

        {/* Divider */}
        {showSso && showPasswordSignUp ? (
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border)]" />
          </div>
          <div className="relative flex justify-center text-xs">
              <span className='bg-[var(--background)] px-4 text-[var(--muted)]'>
                or create with email
              </span>
          </div>
        </div>
        ) : null}

        {/* Email/Password Form */}
        {showPasswordSignUp ? (
          <EmailPasswordSignUpForm
            firstName={firstName}
            lastName={lastName}
            email={email}
            password={password}
            confirmPassword={confirmPassword}
            loading={loading}
            fieldClass={field}
            labelClass={labelText}
            mutedClass={muted}
            submitClass={submit}
            onFirstNameChange={setFirstName}
            onLastNameChange={setLastName}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={handleSubmit}
          />
        ) : null}

        <LegalFinePrint />

        <p className={`mt-6 text-center text-sm ${muted}`}>
          Already have an account?{' '}
          <Link
            href={signInHref}
            className={createLink}
          >
            Sign in
          </Link>
        </p>
      </div>
    </LandingAuthPageChrome>
  )
}
