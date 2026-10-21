'use client'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { LandingAuthPageChrome } from './AuthPageChrome'
import { readAuthErrorMessage } from '@/shared/auth/auth-error-message'

export { readAuthErrorMessage }

export async function postVerifyEmail(
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
      return { error: readAuthErrorMessage(data, fallbackError) }
    }
    return {}
  } catch {
    return { error: 'An unexpected error occurred' }
  }
}

export function CheckEmailScreen({
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
          <Input
            type="text"
            aria-label="Verification code"
            value={verificationCode}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="Enter 6-digit code"
            maxLength={6}
            className={unstyledInput(`${fieldClass} text-center font-mono tracking-widest`)}
            ref={codeInputRef}
          />
          <Button variant="ghost"
            type="submit"
            disabled={verifying || verificationCode.length < 6}
            className={unstyledButton(submitClass)}
          >
            {verifying ? 'Verifying...' : 'Verify email'}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-(--muted)">
          <span>Didn&apos;t receive the code?</span>
          <Button variant="ghost"
            onClick={onResend}
            disabled={resending}
            className={unstyledButton(`text-(--foreground) hover:underline font-medium disabled:opacity-50`)}
          >
            {resending ? 'Sending...' : 'Resend'}
          </Button>
        </div>

        <div className="mt-6 pt-4 border-t border-(--border) text-center">
          <Link
            href="/auth/sign-in"
            className="text-sm text-(--muted) hover:text-(--foreground)"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </LandingAuthPageChrome>
  )
}

