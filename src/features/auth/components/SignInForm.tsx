'use client'

import { useState } from 'react'
import {
  SsoProviderIcon,
  useAuthUiOptions,
  type PublicSsoProvider,
} from '@/features/auth/components/useAuthUiOptions'

interface SignInFormProps {
  redirectTo: string
  onClose?: () => void
  ssoEnabled?: boolean
}

export function SignInForm({ redirectTo, onClose, ssoEnabled = true }: SignInFormProps) {
  const [ssoLoading, setSsoLoading] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const authUiOptions = useAuthUiOptions()

  function handleSSO(provider: PublicSsoProvider) {
    if (!ssoEnabled) return
    setSsoLoading(provider)
    window.location.assign(`/api/auth/sso/${provider}?redirect=${encodeURIComponent(redirectTo)}`)
  }

  function handleEmailContinue() {
    if (email.trim()) {
      sessionStorage.setItem('overlay_signin_email', email.trim())
    }
    const dest = `/auth/sign-in?redirect=${encodeURIComponent(redirectTo)}`
    window.location.assign(dest)
  }

  const ssoBtn =
    'w-full flex items-center justify-center gap-3 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 border bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-subtle)]'
  const ssoProviders = authUiOptions?.ssoProviders ?? []
  const showSso = Boolean(ssoEnabled && authUiOptions?.supportsSso && ssoProviders.length > 0)
  const showEmail = Boolean(authUiOptions?.supportsPasswordSignIn || authUiOptions?.supportsPasswordSignUp)

  return (
    <div className="space-y-2">
      {showSso ? (
        <>
          {ssoProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleSSO(provider.id)}
              disabled={ssoLoading !== null}
              className={ssoBtn}
            >
              <SsoProviderIcon icon={provider.icon} />
              {ssoLoading === provider.id ? 'Redirecting…' : provider.label}
            </button>
          ))}

          {showEmail ? (
          <div className="relative my-3">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border)]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-[var(--surface-elevated)] text-[var(--muted)]">or</span>
            </div>
          </div>
          ) : null}
        </>
      ) : null}

      {showEmail ? (
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleEmailContinue() }}
          placeholder="Enter your email"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--muted)] transition-colors"
        />
        <button
          type="button"
          onClick={handleEmailContinue}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)] whitespace-nowrap"
        >
          Continue
        </button>
      </div>
      ) : null}

      {onClose && (
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
