import 'server-only'

import { logger } from '@/server/observability/logger'
// Simple server-side Convex HTTP client for the landing page.
// Browser code must use ConvexReactClient or typed Next API routes.

// Use dev Convex URL in development, production URL in production
const IS_DEV = process.env.NODE_ENV === 'development'

function resolveConvexUrl(): { url: string | undefined; source: string } {
  if (IS_DEV && process.env.DEV_NEXT_PUBLIC_CONVEX_URL) {
    return { url: process.env.DEV_NEXT_PUBLIC_CONVEX_URL, source: 'DEV_NEXT_PUBLIC_CONVEX_URL' }
  }

  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { url: process.env.NEXT_PUBLIC_CONVEX_URL, source: 'NEXT_PUBLIC_CONVEX_URL' }
  }

  return { url: undefined, source: 'unset' }
}

const { url: CONVEX_URL, source: CONVEX_URL_SOURCE } = resolveConvexUrl()
const IS_BROWSER = typeof window !== 'undefined'

if (!CONVEX_URL && !IS_BROWSER) {
  logger.warn('CONVEX_URL is not set')
} else if (CONVEX_URL) {
  logger.info(
    `[Convex] Using ${IS_DEV ? 'DEV' : 'PROD'} environment: ${CONVEX_URL} (source: ${CONVEX_URL_SOURCE})`
  )
}

interface ConvexResponse<T> {
  status: 'success' | 'error'
  value?: T
  errorMessage?: string
}

interface CallConvexOptions {
  timeoutMs?: number
  throwOnError?: boolean
  background?: boolean
  suppressNetworkConsoleError?: boolean
}

function isBenignBackgroundConvexError(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('network request failed') ||
    normalized.includes('aborted') ||
    normalized.includes('timed out')
  )
}

function shouldSuppressConvexError(
  options: CallConvexOptions,
  errorOrMessage: unknown
): boolean {
  if (!options.background && !options.suppressNetworkConsoleError) {
    return false
  }

  const message =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : errorOrMessage instanceof Error
        ? errorOrMessage.message
        : String(errorOrMessage ?? '')

  return isBenignBackgroundConvexError(message)
}

async function callConvex<T>(
  type: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>,
  options: CallConvexOptions = {}
): Promise<T | null> {
  if (!IS_BROWSER && !CONVEX_URL) {
    logger.error('CONVEX_URL not configured')
    return null
  }

  if (IS_BROWSER) {
    const message = 'Browser Convex HTTP proxying is disabled; use ConvexReactClient or a typed API route.'
    if (options.throwOnError) {
      throw new Error(message)
    }
    if (!shouldSuppressConvexError(options, message)) {
      logger.error(message)
    }
    return null
  }

  const endpoint = `${CONVEX_URL}/api/${type}`

  try {
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? 30000
    const timeoutError = new Error(`Convex ${type} request timed out after ${timeoutMs}ms`)
    const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path,
          args,
          format: 'json'
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const rawText = await response.text()
    if (!rawText.trim()) {
      throw new Error(`Convex ${type} returned an empty response body`)
    }

    let data: ConvexResponse<T>
    try {
      data = JSON.parse(rawText) as ConvexResponse<T>
    } catch (_error) {
      throw new Error(`Convex ${type} returned invalid JSON: ${rawText.slice(0, 200)}`)
    }

    if (!response.ok) {
      const message =
        data.errorMessage ||
        ('error' in data && typeof data.errorMessage === 'string'
          ? data.errorMessage
          : `Convex ${type} request failed with HTTP ${response.status}`)
      if (options.throwOnError) {
        throw new Error(message)
      }
      if (!shouldSuppressConvexError(options, message)) {
        logger.error(`Convex ${type} HTTP error:`, message)
      }
      return null
    }

    if (data.status === 'error') {
      if (options.throwOnError) {
        throw new Error(data.errorMessage || `Convex ${type} error`)
      }
      if (!shouldSuppressConvexError(options, data.errorMessage ?? '')) {
        logger.error(`Convex ${type} error:`, data.errorMessage)
      }
      return null
    }

    return data.value ?? null
  } catch (error) {
    if (options.throwOnError) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw controllerSignalReasonMessage(error) ?? new Error(`Convex ${type} request timed out`)
      }
      throw error
    }
    if (!shouldSuppressConvexError(options, error)) {
      logger.error(`Convex ${type} failed:`, error)
    }
    return null
  }
}

function controllerSignalReasonMessage(error: Error): Error | null {
  const cause = 'cause' in error ? error.cause : undefined
  if (cause instanceof Error) {
    return cause
  }

  if ('message' in error && typeof error.message === 'string' && error.message.includes('aborted')) {
    return new Error(error.message)
  }

  return null
}

export const convex = {
  query: <T>(path: string, args: Record<string, unknown>, options?: CallConvexOptions) =>
    callConvex<T>('query', path, args, options),
  mutation: <T>(path: string, args: Record<string, unknown>, options?: CallConvexOptions) =>
    callConvex<T>('mutation', path, args, options),
  action: <T>(path: string, args: Record<string, unknown>, options?: CallConvexOptions) =>
    callConvex<T>('action', path, args, options)
}
