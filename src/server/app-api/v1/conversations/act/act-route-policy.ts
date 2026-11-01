import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'

export type ActRoutePolicy =
  | { kind: 'admit' }
  | { kind: 'legacy_execution_retired' }
  | { kind: 'harness_unavailable' }

export function decidePersonalActRoute(input: {
  authType: AuthenticatedAppUser['authType']
  automationExecution?: boolean
  automationMode?: boolean
  harnessReady?: boolean
  mode?: string
}): ActRoutePolicy {
  if (
    (input.authType !== 'session' && input.authType !== 'access-token' && input.authType !== 'api-key')
    || input.automationExecution === true
    || input.automationMode === true
  ) {
    return { kind: 'legacy_execution_retired' }
  }
  if (input.harnessReady === false) return { kind: 'harness_unavailable' }
  return { kind: 'admit' }
}

export function actRoutePolicyResponse(kind: Exclude<ActRoutePolicy['kind'], 'admit'>, requestId: string): Response {
  const message = kind === 'legacy_execution_retired'
    ? 'Use the supported durable automation or surface entry point for this execution mode.'
    : 'The durable Harness backend is unavailable. Try again when Harness is ready.'
  return Response.json(
    { error: kind, code: kind, message, requestId },
    { status: kind === 'legacy_execution_retired' ? 410 : 503, headers: { 'x-request-id': requestId } },
  )
}
