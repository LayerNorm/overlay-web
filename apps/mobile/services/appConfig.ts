import Constants from 'expo-constants'

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readEnv(name: string): string | undefined {
  const processEnv = globalThis.process?.env as Record<string, string | undefined> | undefined
  return readString(processEnv?.[name])
}

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>

export const AUTH_BASE_URL =
  readEnv('EXPO_PUBLIC_AUTH_BASE_URL') ??
  readString(extra.authBaseUrl) ??
  'https://getoverlay.io'
