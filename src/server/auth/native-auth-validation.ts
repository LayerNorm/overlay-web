import 'server-only'

export const NATIVE_AUTH_ALLOWED_REDIRECT_ORIGINS = [
  'https://www.getoverlay.io/auth/native/callback',
] as const

const NATIVE_AUTH_PROVIDERS = ['GoogleOAuth', 'AppleOAuth', 'MicrosoftOAuth', 'authkit'] as const

export type NativeAuthProvider = (typeof NATIVE_AUTH_PROVIDERS)[number]

export function isNativeAuthProvider(value: unknown): value is NativeAuthProvider {
  return typeof value === 'string' && (NATIVE_AUTH_PROVIDERS as readonly string[]).includes(value)
}

export function isAllowedNativeRedirectUri(
  value: unknown,
  expectedOrigin = 'https://www.getoverlay.io',
): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    const hasNoInjectedParams = url.search === '' && url.hash === ''
    return (
      hasNoInjectedParams &&
      url.origin === new URL(expectedOrigin).origin &&
      url.pathname === '/auth/native/callback'
    )
  } catch (_error) {
    return false
  }
}

export function isValidNativeAuthState(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.trim())
}

export function isValidNativeAuthCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~+/=-]{8,4096}$/.test(value.trim())
}

export function isValidPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value.trim())
}

export function isAllowedWorkOsAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'api.workos.com' &&
      url.pathname === '/user_management/authorize'
    )
  } catch (_error) {
    return false
  }
}
