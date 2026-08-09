import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

export type ObservabilityContext = {
  deployment: string
  environment: string
  provider?: string
  release: string
  requestId?: string
  route?: string
  runId?: string
  tenantId?: string
}

const contextStorage = new AsyncLocalStorage<ObservabilityContext>()
const OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export function getObservabilityContext(): ObservabilityContext {
  return contextStorage.getStore() ?? baseObservabilityContext()
}

export async function withObservabilityContext<T>(
  context: Partial<ObservabilityContext>,
  operation: () => Promise<T>,
): Promise<T> {
  return await contextStorage.run({
    ...getObservabilityContext(),
    ...sanitizeObservabilityContext(context),
  }, operation)
}

export function contextForRequest(request: Request, context: {
  provider?: string
  runId?: string
  tenantId?: string
} = {}): Partial<ObservabilityContext> {
  return {
    ...sanitizeObservabilityContext(context),
    requestId: opaqueIdentifier(request.headers.get('x-request-id')),
    route: redactRoute(request.url),
  }
}

export function sanitizeObservabilityContext(
  context: Partial<ObservabilityContext>,
): Partial<ObservabilityContext> {
  return compactContext({
    deployment: opaqueIdentifier(context.deployment),
    environment: opaqueIdentifier(context.environment),
    provider: opaqueIdentifier(context.provider),
    release: opaqueIdentifier(context.release),
    requestId: opaqueIdentifier(context.requestId),
    route: context.route ? redactRoute(context.route) : undefined,
    runId: opaqueIdentifier(context.runId),
    tenantId: opaqueIdentifier(context.tenantId),
  })
}

function baseObservabilityContext(): ObservabilityContext {
  return {
    deployment: opaqueIdentifier(process.env.OVERLAY_DEPLOYMENT_ID)
      ?? opaqueIdentifier(process.env.VERCEL_ENV)
      ?? 'local',
    environment: opaqueIdentifier(process.env.OVERLAY_DEPLOYMENT_ENV)
      ?? opaqueIdentifier(process.env.VERCEL_ENV)
      ?? opaqueIdentifier(process.env.NODE_ENV)
      ?? 'unknown',
    release: opaqueIdentifier(process.env.OVERLAY_RELEASE)
      ?? opaqueIdentifier(process.env.VERCEL_GIT_COMMIT_SHA)
      ?? 'unknown',
  }
}

function compactContext(context: Partial<ObservabilityContext>): Partial<ObservabilityContext> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<ObservabilityContext>
}

function opaqueIdentifier(value: string | undefined | null): string | undefined {
  const normalized = value?.trim()
  return normalized && OPAQUE_IDENTIFIER_PATTERN.test(normalized) ? normalized : undefined
}

function redactRoute(value: string): string | undefined {
  let pathname: string
  try {
    pathname = new URL(value, 'http://overlay.invalid').pathname
  } catch (_error) {
    return undefined
  }
  const route = pathname.split('/').map((segment) => {
    if (!segment) return segment
    if (/^[a-z][a-z0-9-]{0,63}$/.test(segment)) return segment
    return ':id'
  }).join('/')
  return route.length <= 256 ? route : undefined
}
