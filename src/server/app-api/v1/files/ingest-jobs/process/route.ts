import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { fileService } from '@/server/files/http'
import { downloadBuffer } from '@/server/storage/r2'

type IngestionJobs = ReturnType<typeof getOverlayServerContext>['appData']['repositories']['fileIngestionJobs']
type ProcessingJob = NonNullable<Awaited<ReturnType<IngestionJobs['getJobForProcessing']>>>

/**
 * Internal endpoint called by the Convex ingestion runner to process
 * a single ingestion job. This runs on the BFF so it has access to R2
 * and the text extraction libraries.
 *
 * The request must include x-internal-api-secret for authorization.
 */
async function processSourceJob(
  job: ProcessingJob,
  ingestionJobs: IngestionJobs,
  attemptToken: string,
): Promise<NextResponse> {
  const { userId, fileName, mimeType, sourceFileId, sourceChecksumSha256 } = job
  if (!sourceFileId || !sourceChecksumSha256 || !/^[a-f0-9]{64}$/.test(sourceChecksumSha256)) {
    return NextResponse.json({ error: 'Source revision is missing.' }, { status: 400 })
  }
  try {
    const original = await fileService.readOriginalFile({
      fileId: sourceFileId, userId, workspaceId: job.workspaceId,
    })
    if (original.sizeBytes !== job.sizeBytes || original.name !== fileName
      || original.mimeType !== mimeType || original.revision !== sourceChecksumSha256) {
      throw new Error('Persisted source job does not match the authorized original.')
    }
    const extraction = await fileService.extractSourceFile({
      fileId: sourceFileId, userId, sourceChecksumSha256, bytes: original.bytes,
      jobId: job._id, attemptToken,
    })
    await ingestionJobs.updateJobStatus({
      jobId: job._id, userId, status: 'completed', fileIds: [sourceFileId], partCount: 1,
      attemptToken,
      statusMessage: extraction.extractionStatus === 'ready'
        ? `Original file ready; extraction ${extraction.extractionTruncated ? 'truncated at 10 MiB' : 'complete'}.`
        : 'Original file is available; no extractable text was found.',
    })
    return NextResponse.json({ success: true, fileIds: [sourceFileId], extraction })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed'
    await fileService.markSourceExtractionFailed({
      fileId: sourceFileId, jobId: job._id, userId, attemptToken, sourceChecksumSha256,
      error: message,
    }).catch((_error) => undefined)
    await ingestionJobs.updateJobStatus({
      jobId: job._id, userId, status: 'failed', error: message.slice(0, 500),
      attemptToken,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function processLegacyJob(
  job: ProcessingJob,
  ingestionJobs: IngestionJobs,
  attemptToken: string,
): Promise<NextResponse> {
  const { userId, r2Key, fileName, mimeType, parentId } = job
  try {
    const buffer = await downloadBuffer(r2Key)
    if (!buffer) {
      await ingestionJobs.updateJobStatus({
        jobId: job._id, userId, status: 'failed', error: 'File not found in R2', attemptToken,
      })
      return NextResponse.json({ error: 'File not found in R2' }, { status: 404 })
    }
    const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType })
    const result = await fileService.ingestDocument({
      userId,
      file,
      ...(typeof parentId === 'string' ? { parentId } : {}),
      ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
    })
    await ingestionJobs.updateJobStatus({
      jobId: job._id, userId, status: 'completed',
      partCount: result.parts, fileIds: (result.ids ?? []).filter(Boolean), attemptToken,
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await ingestionJobs.updateJobStatus({
      jobId: job._id, userId, status: 'failed', error: message.slice(0, 500), attemptToken,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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
  return job.sourceFileId
    ? processSourceJob(job, ingestionJobs, attemptToken)
    : processLegacyJob(job, ingestionJobs, attemptToken)
}
