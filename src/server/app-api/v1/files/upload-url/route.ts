import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { fileService, fileUploadUrlErrorResponse } from '@/server/files/http'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { sizeBytes, name, mimeType, checksumSha256 } = await request.json().catch((_error) => ({})) as {
      sizeBytes?: number
      name?: string
      mimeType?: string
      checksumSha256?: string
    }
    const { auth } = context
    const result = await fileService.createUploadUrl({
      userId: auth.userId,
      sizeBytes,
      name,
      mimeType,
      checksumSha256,
    })
    return NextResponse.json(result)
  } catch (error) {
    return fileUploadUrlErrorResponse(error)
  }
}
