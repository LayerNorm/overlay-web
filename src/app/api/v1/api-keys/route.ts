import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getClientIp } from '@/server/security/rate-limit'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleBffRoute, type BffDomainService } from '../_utils/bff'

const listKeys: BffDomainService = async (_request, context) => {
  const keys = await getOverlayServerContext().apiKeyService.list({ userId: context.auth.userId })
  return NextResponse.json({ keys })
}

const createKey: BffDomainService = async (request, context) => {
  try {
    const key = await getOverlayServerContext().apiKeyService.create({
      createdBy: context.auth.userId,
      createdFromIp: getClientIp(request),
      name: optionalString(context.parsedJson.name),
      userId: context.auth.userId,
      scopes: arrayValue(context.parsedJson.scopes),
      expiresAt: optionalNumber(context.parsedJson.expiresAt),
    })
    return NextResponse.json({ key }, { status: 201 })
  } catch (error) {
    return invalidRequest(error)
  }
}

const rotateKey: BffDomainService = async (request, context) => {
  try {
    const key = await getOverlayServerContext().apiKeyService.rotateById({
      createdBy: context.auth.userId,
      createdFromIp: getClientIp(request),
      expiresAt: optionalNumber(context.parsedJson.expiresAt),
      id: requiredString(context, 'id'),
      name: optionalString(context.parsedJson.name),
      revokedReason: 'rotated_by_user',
      scopes: arrayValue(context.parsedJson.scopes),
      userId: context.auth.userId,
    })
    if (!key) return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    return NextResponse.json({ key })
  } catch (error) {
    return invalidRequest(error)
  }
}

const revokeKey: BffDomainService = async (_request, context) => {
  try {
    const revoked = await getOverlayServerContext().apiKeyService.revokeById({
      id: requiredString(context, 'id'),
      revokedReason: optionalString(context.parsedJson.reason) ?? 'revoked_by_user',
      userId: context.auth.userId,
    })
    return revoked
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'API key not found' }, { status: 404 })
  } catch (error) {
    return invalidRequest(error)
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listKeys)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, createKey)
}

export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, rotateKey)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, revokeKey)
}

function requiredString(context: AppApiRouteContext, field: string): string {
  const value = context.parsedJson[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('expiresAt must be a timestamp')
  return parsed
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('scopes must be an array')
  return value
}

function invalidRequest(error: unknown): Response {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Invalid API key request' },
    { status: 400 },
  )
}
