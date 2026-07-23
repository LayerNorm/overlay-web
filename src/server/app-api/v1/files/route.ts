import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { fileErrorResponse, fileService } from '@/server/files/http'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { searchParams } = request.nextUrl
    const result = await fileService.getOrListFiles({
      userId: getAuthorizedResourceUserId(context),
      fileId: searchParams.get('fileId'),
      projectId: searchParams.get('projectId'),
      kind: searchParams.get('kind'),
      parentId: searchParams.get('parentId'),
      conversationId: searchParams.get('conversationId'),
      outputType: searchParams.get('outputType') ?? searchParams.get('type'),
      summary: ['true', '1'].includes(searchParams.get('summary') ?? ''),
    })
    if (!Array.isArray(result) || searchParams.get('fileId')) return NextResponse.json(result)
    const granted = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
      fileService.getOrListFiles({ fileId: resourceId, userId: ownerUserId })
    )))
    return NextResponse.json([...result, ...granted.filter((file) => grantedFileMatches(file, searchParams))])
  } catch (error) {
    if (error instanceof Error && error.name === 'FileServiceError') {
      return fileErrorResponse(error, 'Failed to fetch files')
    }
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
  }
}

function grantedFileMatches(file: unknown, searchParams: URLSearchParams): boolean {
  if (!file || typeof file !== 'object') return false
  const value = file as Record<string, unknown>
  const filters = [
    ['projectId', searchParams.get('projectId')],
    ['kind', searchParams.get('kind')],
    ['parentId', searchParams.get('parentId')],
    ['conversationId', searchParams.get('conversationId')],
    ['outputType', searchParams.get('outputType') ?? searchParams.get('type')],
  ] as const
  return filters.every(([key, expected]) => !expected || value[key] === expected)
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const formDataContentType = request.headers.get('content-type') || ''
    const body = formDataContentType.includes('application/json') ? await request.json() : {}
    const result = await fileService.createFile({
      userId: getAuthorizedResourceUserId(context),
      body: body as Record<string, unknown>,
    })
    return NextResponse.json(result)
  } catch (error) {
    return fileErrorResponse(error, 'Failed to create file')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const result = await fileService.updateFile({
      userId: getAuthorizedResourceUserId(context),
      body: body as Record<string, unknown>,
    })
    return NextResponse.json(result)
  } catch (error) {
    return fileErrorResponse(error, 'Failed to update file')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    let body: { accessToken?: string; userId?: string; fileId?: string } = {}
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      try {
        body = await request.json()
      } catch (_error) {
        body = {}
      }
    }
    const result = await fileService.deleteFile({
      fileId: request.nextUrl.searchParams.get('fileId') || body.fileId,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('[FilesDelete] failed', error)
    return fileErrorResponse(error, 'Failed to delete file')
  }
}
