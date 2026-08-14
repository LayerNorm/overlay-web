import { NextResponse, type NextRequest } from 'next/server'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { fileService } from '@/server/files/http'
import { downloadBuffer } from '@/server/storage/r2'

/**
 * Internal endpoint called by the Convex ingestion runner to process
 * a single ingestion job. This runs on the BFF so it has access to R2
 * and the text extraction libraries.
 *
 * The request must include x-internal-api-secret for authorization.
 */
export async function POST(request: NextRequest) {
  // Authorize via internal API secret
  const secret = request.headers.get('x-internal-api-secret')
  if (!secret || secret !== getInternalApiSecret()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch((_error) => null)
  if (!body || typeof body.jobId !== 'string' || typeof body.r2Key !== 'string') {
    return NextResponse.json({ error: 'jobId and r2Key are required' }, { status: 400 })
  }

  const { jobId, userId, r2Key, fileName, mimeType, projectId, parentId } = body

  try {
    // Download the file from R2
    const buffer = await downloadBuffer(r2Key)

    if (!buffer) {
      await convex.mutation('files/ingestion/jobs:updateJobStatus', {
        jobId: jobId as never,
        userId,
        status: 'failed',
        error: 'File not found in R2',
        serverSecret: getInternalApiSecret(),
      })
      return NextResponse.json({ error: 'File not found in R2' }, { status: 404 })
    }

    // Create a File-like object for the existing ingestDocument method
    const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType })

    // Use the existing fileService.ingestDocument for text extraction + record creation
    const result = await fileService.ingestDocument({
      userId,
      file,
      ...(typeof projectId === 'string' ? { projectId } : {}),
      ...(typeof parentId === 'string' ? { parentId } : {}),
    })

    // Mark job as completed
    await convex.mutation('files/ingestion/jobs:updateJobStatus', {
      jobId: jobId as never,
      userId,
      status: 'completed',
      partCount: result.parts,
      fileIds: (result.ids ?? []).filter(Boolean) as never,
      serverSecret: getInternalApiSecret(),
    })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await convex.mutation('files/ingestion/jobs:updateJobStatus', {
      jobId: jobId as never,
      userId,
      status: 'failed',
      error: message.slice(0, 500),
      serverSecret: getInternalApiSecret(),
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
