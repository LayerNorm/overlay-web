import Constants from 'expo-constants'

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>

function normalizeBaseUrl(value: string): string {
  const withoutTrailingSlash = value.replace(/\/+$/, '')

  if (withoutTrailingSlash === 'https://getoverlay.io') {
    return 'https://www.getoverlay.io'
  }

  return withoutTrailingSlash
}

export const AUTH_BASE_URL =
  normalizeBaseUrl(
    readString(process.env.EXPO_PUBLIC_AUTH_BASE_URL) ??
      readString(extra.authBaseUrl) ??
      'https://www.getoverlay.io',
  )

export const PRODUCTION_AUTH_BASE_URL = 'https://www.getoverlay.io'
