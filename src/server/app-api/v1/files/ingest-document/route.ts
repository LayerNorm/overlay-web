import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { fileIngestErrorResponse, fileService } from '@/server/files/http'
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    let form: FormData
    try {
      form = await request.formData()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Failed to parse body as FormData') || message.includes('exceeded') || message.includes('payload')) {
        return NextResponse.json(
          { error: 'File too large. Maximum upload size is 12 MB.' },
          { status: 413 },
        )
      }
      throw error
    }

    const raw = form.get('file')
    const result = await fileService.ingestDocument({
      userId: auth.userId,
      file: raw instanceof File ? raw : null,
      projectId: typeof form.get('projectId') === 'string' ? form.get('projectId') as string : undefined,
      parentId: typeof form.get('parentId') === 'string' ? form.get('parentId') as string : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    return fileIngestErrorResponse(error)
  }
}
