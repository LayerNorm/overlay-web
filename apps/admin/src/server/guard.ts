import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { AdministrativeAuthorizationError } from './admin/AdministrativeService'
import { AuthorizationDeniedError } from './authorization/AuthorizationService'
import { getAdminServerContext } from './context'
import { runWithOperatorAccessToken } from './convex-admin'
import { resolveOperator, type OperatorResolution } from './operator'
import {
  ADMIN_SESSION_COOKIE,
  hasRecentSignIn,
  sealPayload,
  serializeCookie,
  SESSION_ABSOLUTE_TTL_MS,
  touchSessionCookie,
  type AdminSession,
} from './session'
import type { AdministrativePrincipal } from './admin/AdministrativeRepository'

export type AdminRouteContext = {
  operator: {
    principal: AdministrativePrincipal
    session: AdminSession
    user: { email: string; firstName: string | null; id: string; lastName: string | null }
  }
}

type AdminRouteHandler = (request: NextRequest, context: AdminRouteContext) => Promise<Response> | Response

export function getClientIp(request: NextRequest): string | undefined {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || undefined
  )
}

export function parseJson(request: NextRequest): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export function queryParams(request: NextRequest): Record<string, string | true> {
  const params: Record<string, string | true> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    params[key] = value === 'true' ? true : value
  }
  return params
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === true) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function requiredString(value: unknown): string {
  const parsed = optionalString(value)
  if (!parsed) throw new AdminValidationError('Missing required field')
  return parsed
}

export class AdminValidationError extends Error {
  readonly statusCode = 400
}

function applyRefreshedSession(response: Response, session: AdminSession, forceRewrite: boolean): Response {
  // Roll the idle window forward on every authenticated response, and rewrite
  // the cookie when token refresh mutated the payload.
  const header = forceRewrite
    ? serializeCookie(ADMIN_SESSION_COOKIE, sealPayload({ ...session, lastActiveAt: Date.now() }), Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000))
    : touchSessionCookie(session)
  response.headers.append('Set-Cookie', header)
  return response
}

/**
 * Wraps an admin API handler: resolves the operator (session -> allowlist ->
 * active principal row), enforces the recent sign-in window on mutations,
 * re-mints the session cookie on the way out, and records denied attempts.
 */
export function adminRoute(
  handler: AdminRouteHandler,
  options: { auditAction?: string; mutation?: boolean; resourceType?: string } = {},
) {
  return async (request: NextRequest): Promise<Response> => {
    const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    const outcome: OperatorResolution = await resolveOperator(cookie)

    if (outcome.kind === 'anonymous') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (outcome.kind === 'denied') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (options.mutation && !hasRecentSignIn(outcome.session)) {
      return NextResponse.json({ error: 'recent_sign_in_required' }, { status: 403 })
    }

    const context: AdminRouteContext = {
      operator: { principal: outcome.principal, session: outcome.session, user: outcome.user },
    }

    try {
      const response = await runWithOperatorAccessToken(
        outcome.session.accessToken,
        async () => await handler(request, context),
      )
      return applyRefreshedSession(response, outcome.session, outcome.sessionMutated)
    } catch (error) {
      return adminErrorResponse(error, request, context, options)
    }
  }
}

export async function adminErrorResponse(
  error: unknown,
  request: NextRequest,
  context: AdminRouteContext,
  options: { auditAction?: string; resourceType?: string } = {},
): Promise<Response> {
  const server = getAdminServerContext()
  if (error instanceof AdminValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof AdministrativeAuthorizationError || error instanceof AuthorizationDeniedError) {
    if (options.auditAction) {
      await server.auditService.record({
        action: options.auditAction,
        actorType: 'user',
        actorUserId: context.operator.user.id,
        ipAddress: getClientIp(request),
        outcome: 'denied',
        requestId: request.headers.get('x-request-id') ?? undefined,
        resourceType: options.resourceType ?? 'authorization',
      })
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json({ error: 'An authorization record with that name already exists' }, { status: 409 })
  }
  if (error instanceof Error) {
    if (/not found/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (/cannot|archived|externally managed|system authorization/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
  }
  throw error
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === '23505',
  ) || (error instanceof Error && /already exists|duplicate/i.test(error.message))
}
