import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { AdministrativeAuthorizationError } from '@/server/admin'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

const listAudit: BffDomainService = async (_request, context) => {
  const server = getOverlayServerContext()
  if (server.appDataCapabilities.provider !== 'postgres') {
    return NextResponse.json({ error: 'Administrative audit API requires Postgres app-data' }, { status: 501 })
  }
  try {
    await server.administrativeService.assertCanViewAudit(context.auth.userId)
    const events = await server.auditService.list({
      action: optionalString(context.parsedQuery.action),
      actorUserId: optionalString(context.parsedQuery.actorUserId),
      before: optionalNumber(context.parsedQuery.before),
      limit: optionalNumber(context.parsedQuery.limit),
      resourceType: optionalString(context.parsedQuery.resourceType),
    })
    return NextResponse.json({ events })
  } catch (error) {
    if (error instanceof AdministrativeAuthorizationError) {
      await server.auditService.record({
        action: 'administration.audit.list',
        actorApiKeyId: context.auth.apiKeyId,
        actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
        actorUserId: context.auth.userId,
        outcome: 'denied',
        resourceType: 'audit_event',
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    throw error
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listAudit)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
