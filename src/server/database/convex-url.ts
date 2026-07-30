import 'server-only'

/**
 * Convex endpoint resolution, kept pure so it can be tested without a network
 * or a module-cache dance.
 *
 * Values pasted into a hosting dashboard routinely arrive with surrounding
 * whitespace, wrapping quotes, or a trailing slash. Left alone they produce a
 * bare "fetch failed" at request time, which reads as an outage rather than a
 * typo, so the value is normalized and validated here where it can be named.
 */
export type ConvexUrlResolution = {
  url?: string
  source: string
  invalid?: string
}

export const CONVEX_URL_ENV_KEYS = {
  dev: 'DEV_NEXT_PUBLIC_CONVEX_URL',
  default: 'NEXT_PUBLIC_CONVEX_URL',
} as const

export function resolveConvexUrl(
  env: Record<string, string | undefined>,
  options: { isDev?: boolean } = {},
): ConvexUrlResolution {
  const candidates: Array<[string, string | undefined]> = options.isDev
    ? [
      [CONVEX_URL_ENV_KEYS.dev, env[CONVEX_URL_ENV_KEYS.dev]],
      [CONVEX_URL_ENV_KEYS.default, env[CONVEX_URL_ENV_KEYS.default]],
    ]
    : [[CONVEX_URL_ENV_KEYS.default, env[CONVEX_URL_ENV_KEYS.default]]]

  for (const [source, raw] of candidates) {
    const normalized = normalizeConvexUrl(raw)
    if (!normalized) continue
    let parsed: URL
    try {
      parsed = new URL(normalized)
    } catch (_error) {
      return {
        source,
        invalid: `${source} is not a valid absolute URL (received ${JSON.stringify(raw)})`,
      }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        source,
        invalid: `${source} must be an http or https URL, received ${parsed.protocol}`,
      }
    }
    if (SCHEME_WORDS.has(parsed.hostname.toLowerCase())) {
      const suggestion = doubledSchemeSuggestion(normalized)
      return {
        source,
        invalid: suggestion
          ? `${source} contains two schemes (received ${JSON.stringify(raw)}); use ${suggestion}`
          : `${source} resolves to the host "${parsed.hostname}", which is a URL scheme rather than a `
            + `deployment (received ${JSON.stringify(raw)})`,
      }
    }
    return { url: parsed.origin, source }
  }

  return { source: 'unset' }
}

/** Scheme words that can never be a real deployment hostname. */
const SCHEME_WORDS = new Set(['http', 'https', 'ws', 'wss'])

/**
 * A doubled scheme parses successfully but points nowhere: the host becomes
 * "https" and the intended host is demoted to the path. Dashboard fields that
 * pre-fill a scheme make this a common paste error, so it is named rather than
 * left to fail later as an unexplained DNS error.
 */
function doubledSchemeSuggestion(value: string): string | undefined {
  const match = /^(?:https?|wss?):\/\/((?:https?|wss?):\/\/.+)$/i.exec(value)
  return match?.[1]
}

export function normalizeConvexUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '').trim()
  return trimmed ? trimmed : undefined
}

/**
 * Wraps a transport failure with the endpoint and the variable that produced it.
 * Without this, a DNS or connection error reaches the app shell as an
 * unattributed "fetch failed".
 */
export function convexNetworkFailure(args: {
  cause: unknown
  endpoint: string
  path: string
  source: string
  type: string
}): Error {
  const detail = args.cause instanceof Error ? args.cause.message : String(args.cause)
  return new Error(
    `Convex ${args.type} ${args.path} could not reach ${convexHostLabel(args.endpoint)} `
    + `(from ${args.source}): ${detail}`,
    { cause: args.cause },
  )
}

export function convexHostLabel(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch (_error) {
    return 'the configured Convex deployment'
  }
}
