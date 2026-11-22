import Constants from 'expo-constants'

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const PRODUCTION_AUTH_BASE_URL = 'https://overlay.works'

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>

function normalizeBaseUrl(value: string): string {
  const withoutTrailingSlash = value.replace(/\/+$/, '')

  if (withoutTrailingSlash === 'https://getoverlay.io' || withoutTrailingSlash === 'https://www.getoverlay.io') {
    return PRODUCTION_AUTH_BASE_URL
  }

  return withoutTrailingSlash
}

export const AUTH_BASE_URL =
  normalizeBaseUrl(
    readString(process.env.EXPO_PUBLIC_AUTH_BASE_URL) ??
      readString(extra.authBaseUrl) ??
      PRODUCTION_AUTH_BASE_URL,
  )
