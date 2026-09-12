import { NextResponse } from 'next/server'
import {
  COMPUTER_OWNER_TYPES,
  COMPUTER_SIZES,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { actorFrom, computerErrorResponse } from './shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const computers = await getOverlayServerContext().computerService.listForWorkspace({
      actor: actorFrom(context),
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ computers }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return computerErrorResponse(error)
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson
    const ownerType = enumValue(body.ownerType, COMPUTER_OWNER_TYPES)
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : ''
    if (!ownerType || !ownerId) {
      return NextResponse.json(
        { error: 'ownerType and ownerId are required', code: 'validation_error' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const computer = await getOverlayServerContext().computerService.provision({
      actor: actorFrom(context),
      workspaceId: context.workspace.workspace.id,
      ownerType,
      ownerId,
      size: enumValue(body.size, COMPUTER_SIZES),
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    })
    return NextResponse.json({ computer }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return computerErrorResponse(error)
  }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : undefined
}
