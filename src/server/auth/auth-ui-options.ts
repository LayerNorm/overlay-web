import 'server-only'

import { resolveBetterAuthRuntimeConfig } from '@/server/auth/better-auth'
import type { AuthUiOptions } from '@/shared/auth/auth-ui-options'
import type { OverlayRuntimeConfig } from '@/shared/config'

const WORKOS_UI_OPTIONS: AuthUiOptions = {
  provider: 'workos',
  supportsSso: true,
  supportsPasswordSignIn: true,
  supportsPasswordSignUp: true,
  supportsPasswordReset: true,
  supportsEmailVerification: true,
  ssoProviders: [
    { id: 'google', label: 'Continue with Google', icon: 'google' },
    { id: 'apple', label: 'Continue with Apple', icon: 'apple' },
    { id: 'microsoft', label: 'Continue with Microsoft', icon: 'microsoft' },
  ],
}

export function getAuthUiOptionsForConfig(config: OverlayRuntimeConfig): AuthUiOptions {
  const selected = config.providers.auth?.provider ?? config.auth.provider
  if (selected === 'workos') {
    return cloneAuthUiOptions(WORKOS_UI_OPTIONS)
  }
  if (selected !== 'better-auth') {
    return {
      provider: selected,
      supportsSso: false,
      supportsPasswordSignIn: false,
      supportsPasswordSignUp: false,
      supportsPasswordReset: false,
      supportsEmailVerification: false,
      ssoProviders: [],
    }
  }

  const resolved = resolveBetterAuthRuntimeConfig(config)
  return {
    provider: 'better-auth',
    supportsSso: resolved.connections.length > 0,
    supportsPasswordSignIn: false,
    supportsPasswordSignUp: false,
    supportsPasswordReset: false,
    supportsEmailVerification: false,
    ssoProviders: resolved.connections.map((connection) => ({
      id: connection.id,
      label: connection.label,
      icon: connection.icon,
    })),
  }
}

function cloneAuthUiOptions(options: AuthUiOptions): AuthUiOptions {
  return {
    ...options,
    ssoProviders: options.ssoProviders.map((provider) => ({ ...provider })),
  }
}
