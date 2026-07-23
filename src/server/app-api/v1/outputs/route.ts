import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { isKnownOutputType } from '@/shared/tools/output-types'
import { outputService } from '@/server/outputs/http'

function originForShareUrl(request: NextRequest): string {
  return request.headers.get('origin') || `${request.nextUrl.protocol}//${request.nextUrl.host}`
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const rawType = request.nextUrl.searchParams.get('type')
    const type = rawType && isKnownOutputType(rawType) ? rawType : null
    const outputs = await outputService.list({
      userId: auth.userId,
      conversationId: request.nextUrl.searchParams.get('conversationId'),
      type,
    })
    const granted = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
      outputService.get({ outputId: resourceId, userId: ownerUserId })
    )))
    return NextResponse.json([...outputs, ...granted.filter((output) => (
      output && (!type || output.type === type) &&
      (!request.nextUrl.searchParams.get('conversationId') ||
        output.conversationId === request.nextUrl.searchParams.get('conversationId'))
    ))])
  } catch (error) {
    logger.error('[Outputs API] list failed:', error)
    return NextResponse.json({ error: 'Failed to fetch outputs' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as {
      outputId?: string
      visibility?: 'private' | 'public'
    }
    if (!body.outputId) return NextResponse.json({ error: 'outputId required' }, { status: 400 })
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return NextResponse.json({ error: 'visibility must be "private" or "public"' }, { status: 400 })
    }
    const result = await outputService.share({
      origin: originForShareUrl(request),
      outputId: body.outputId,
      userId: getAuthorizedResourceUserId(context),
      visibility: body.visibility,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('[Outputs API] share failed:', error)
    const notFound = error instanceof Error && error.message === 'Output not found'
    return NextResponse.json({ error: notFound ? 'Not found' : 'Failed to share output' }, { status: notFound ? 404 : 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const outputId = request.nextUrl.searchParams.get('outputId')
    if (!outputId) return NextResponse.json({ error: 'outputId required' }, { status: 400 })
    await outputService.delete({ outputId, userId: getAuthorizedResourceUserId(context) })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[Outputs API] delete failed:', error)
    const notFound = error instanceof Error && error.message === 'Output not found'
    return NextResponse.json({ error: notFound ? 'Not found' : 'Failed to delete output' }, { status: notFound ? 404 : 500 })
  }
}
