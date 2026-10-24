'use client'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'

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
    'w-full flex items-center justify-center gap-3 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 border bg-(--surface-elevated) border-(--border) text-(--foreground) hover:bg-(--surface-subtle)'
  const ssoProviders = authUiOptions?.ssoProviders ?? []
  const showSso = Boolean(ssoEnabled && authUiOptions?.supportsSso && ssoProviders.length > 0)
  const showEmail = Boolean(authUiOptions?.supportsPasswordSignIn || authUiOptions?.supportsPasswordSignUp)

  if (authUiOptions === null) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading sign-in options">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="flex h-[42px] w-full animate-pulse items-center justify-center rounded-xl border border-(--border) bg-(--surface-subtle)"
          >
            <span className="h-3 w-32 rounded-sm bg-(--border)" />
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <div className="h-[42px] min-w-0 flex-1 animate-pulse rounded-xl border border-(--border) bg-(--surface-subtle)" />
          <div className="h-[42px] w-20 animate-pulse rounded-xl border border-(--border) bg-(--surface-subtle)" />
        </div>
        <span className="sr-only">Loading sign-in options…</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {showSso ? (
        <>
          {ssoProviders.map((provider) => (
            <Button variant="ghost"
              key={provider.id}
              type="button"
              onClick={() => handleSSO(provider.id)}
              disabled={ssoLoading !== null}
              className={unstyledButton(ssoBtn)}
            >
              <SsoProviderIcon icon={provider.icon} />
              {ssoLoading === provider.id ? 'Redirecting…' : provider.label}
            </Button>
          ))}

          {showEmail ? (
          <div className="relative my-3">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-(--border)" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-(--surface-elevated) text-(--muted)">or</span>
            </div>
          </div>
          ) : null}
        </>
      ) : null}

      {showEmail ? (
      <div className="flex gap-2">
        <Input
          type="email"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleEmailContinue() }}
          placeholder="Enter your email"
          className={unstyledInput(`min-w-0 flex-1 rounded-xl border border-(--border) bg-(--surface-elevated) px-3 py-2.5 text-sm text-(--foreground) placeholder:text-(--muted) outline-hidden focus:border-(--muted) transition-colors`)}
        />
        <Button variant="secondary" size="lg"
          type="button"
          onClick={handleEmailContinue}
 className="whitespace-nowrap"
        >
          Continue
        </Button>
      </div>
      ) : null}

      {onClose && (
        <div className="pt-1 text-center">
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            className={unstyledButton(`text-xs text-(--muted) hover:text-(--foreground) transition-colors`)}
          >
            Close
          </Button>
        </div>
      )}
    </div>
  )
}
