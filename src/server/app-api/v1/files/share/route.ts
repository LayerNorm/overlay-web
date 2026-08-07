import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { fileErrorResponse, fileService } from '@/server/files/http'

function originForShareUrl(request: NextRequest): string {
  return request.headers.get('origin') || `${request.nextUrl.protocol}//${request.nextUrl.host}`
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as {
      fileId?: string
      visibility?: 'private' | 'public'
      accessToken?: string
      userId?: string
    }
    const { auth } = context
    const result = await fileService.setShare({
      fileId: body.fileId,
      visibility: body.visibility,
      userId: auth.userId,
      origin: originForShareUrl(request),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'FileServiceError') {
      return fileErrorResponse(error, 'Failed to update share visibility')
    }
    logger.error('[files/share PATCH]', error)
    return NextResponse.json({ error: 'Failed to update share visibility' }, { status: 500 })
  }
}
