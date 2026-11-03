import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
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
  const secret = request.headers.get('x-internal-api-secret')?.trim()
  if (!matchesInternalApiSecret(secret, getInternalApiSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch((_error) => null)
  if (!body || typeof body.jobId !== 'string' || typeof body.attemptToken !== 'string') {
    return NextResponse.json({ error: 'jobId and worker lease are required' }, { status: 400 })
  }

  const ingestionJobs = getOverlayServerContext().appData.repositories.fileIngestionJobs
  const job = await ingestionJobs.getJobForProcessing(body.jobId)
  const attemptToken = body.attemptToken as string
  if (!job || job.status !== 'extracting' || job.leaseToken !== attemptToken
    || (job.leaseExpiresAt ?? 0) <= Date.now()) {
    return NextResponse.json({ error: 'Worker lease is no longer active.' }, { status: 409 })
  }
  const { userId, r2Key, fileName, mimeType, parentId, sourceFileId, sourceChecksumSha256 } = job
  const jobId = job._id

  if (typeof sourceFileId === 'string') {
    if (typeof sourceChecksumSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceChecksumSha256)) {
      return NextResponse.json({ error: 'Source revision is missing.' }, { status: 400 })
    }
    try {
      const original = await fileService.readOriginalFile({ fileId: sourceFileId, userId, workspaceId: job.workspaceId })
      if (original.sizeBytes !== job.sizeBytes || original.name !== fileName
        || original.mimeType !== mimeType || original.revision !== sourceChecksumSha256) {
        throw new Error('Persisted source job does not match the authorized original.')
      }
      const extraction = await fileService.extractSourceFile({
        fileId: sourceFileId, userId, sourceChecksumSha256, bytes: original.bytes,
        jobId, attemptToken,
      })
      await ingestionJobs.updateJobStatus({
        jobId, userId, status: 'completed', fileIds: [sourceFileId], partCount: 1,
        attemptToken,
        statusMessage: extraction.extractionStatus === 'ready'
          ? `Original file ready; extraction ${extraction.extractionTruncated ? 'truncated at 10 MiB' : 'complete'}.`
          : 'Original file is available; no extractable text was found.',
      })
      return NextResponse.json({ success: true, fileIds: [sourceFileId], extraction })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extraction failed'
      await fileService.markSourceExtractionFailed({
        fileId: sourceFileId, jobId, userId, attemptToken, sourceChecksumSha256,
        error: message,
      }).catch((_error) => undefined)
      await ingestionJobs.updateJobStatus({
        jobId, userId, status: 'failed', error: message.slice(0, 500), attemptToken,
      })
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    // Download the file from R2
    const buffer = await downloadBuffer(r2Key)

    if (!buffer) {
      await ingestionJobs.updateJobStatus({
        jobId,
        userId,
        status: 'failed',
        error: 'File not found in R2',
        attemptToken,
      })
      return NextResponse.json({ error: 'File not found in R2' }, { status: 404 })
    }

    // Create a File-like object for the existing ingestDocument method
    const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType })

    // Use the existing fileService.ingestDocument for text extraction + record creation
    const result = await fileService.ingestDocument({
      userId,
      file,
      ...(typeof parentId === 'string' ? { parentId } : {}),
      ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
    })

    // Mark job as completed
    await ingestionJobs.updateJobStatus({
      jobId,
      userId,
      status: 'completed',
      partCount: result.parts,
      fileIds: (result.ids ?? []).filter(Boolean),
      attemptToken,
    })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await ingestionJobs.updateJobStatus({
      jobId,
      userId,
      status: 'failed',
      error: message.slice(0, 500),
      attemptToken,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
