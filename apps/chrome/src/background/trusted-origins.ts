const TRUSTED_OVERLAY_ORIGINS = new Set([
  'https://getoverlay.io',
  'https://www.getoverlay.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

export function normalizeTrustedOverlayBaseUrl(raw: string | null | undefined): string {
  const fallback = 'https://getoverlay.io'
  const candidate = raw?.trim() || fallback
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return fallback
  }
  const origin = parsed.origin.replace(/\/+$/, '')
  return TRUSTED_OVERLAY_ORIGINS.has(origin) ? origin : fallback
}

export function assertTrustedOverlayBaseUrl(raw: string): string {
  const normalized = normalizeTrustedOverlayBaseUrl(raw)
  let requested: string
  try {
    requested = new URL(raw.trim() || normalized).origin.replace(/\/+$/, '')
  } catch {
    throw new Error('Refusing to send Overlay credentials to an untrusted host.')
  }
  if (requested !== normalized) {
    throw new Error('Refusing to send Overlay credentials to an untrusted host.')
  }
  return normalized
}

export function appendUserIdParam(path: string, userId: string): string {
  if (!userId.trim()) return path
  const [pathname, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  if (!params.has('userId')) params.set('userId', userId)
  return `${pathname}?${params.toString()}`
}
