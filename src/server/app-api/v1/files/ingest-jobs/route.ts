import { NextResponse, type NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { createReleaseFlags } from '@/server/releases/feature-flags'
import { fileService, fileIngestErrorResponse } from '@/server/files/http'

/**
 * Create a durable document ingestion job after the client has uploaded
 * the file directly to R2 via a presigned URL.
 *
 * Flow:
 * 1. Client requests presigned upload URL via /api/v1/files/presign
 * 2. Client uploads file directly to R2
 * 3. Client calls this endpoint with the r2Key + metadata
 * 4. Server creates a documentIngestionJobs record (status: queued)
 * 5. Server processes ingestion asynchronously
 * 6. Client subscribes to job status via Convex subscription
 *
 * This replaces the synchronous ingest-document endpoint for the
 * presigned upload flow, keeping the request path fast and non-blocking.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const body = await request.json().catch((_error) => null)
  if (!body || typeof body.r2Key !== 'string' || typeof body.fileName !== 'string') {
    return NextResponse.json({ error: 'r2Key and fileName are required' }, { status: 400 })
  }

  const serverContext = getOverlayServerContext()
  const flags = createReleaseFlags({
    userId: context.auth.userId,
    workspaceId: context.workspace?.workspace?.id ?? '',
  }, ['files-file-first'])
  if (context.workspace?.workspace?.id
    && await flags.isEnabled('files-file-first')
    && typeof body.checksumSha256 === 'string') {
    try {
      const required = ['r2Key', 'fileName', 'mimeType', 'checksumSha256'] as const
      if (required.some(key => typeof body[key] !== 'string') || typeof body.sizeBytes !== 'number') {
        return NextResponse.json({ error: 'File upload metadata is incomplete.' }, { status: 400 })
      }
      const source = await fileService.commitVerifiedIngestUpload({
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        r2Key: body.r2Key as string,
        fileName: body.fileName as string,
        mimeType: body.mimeType as string,
        sizeBytes: body.sizeBytes,
        checksumSha256: body.checksumSha256 as string,
        ...(typeof body.parentId === 'string' ? { parentId: body.parentId } : {}),
        ...(body.scope === 'workspace' || body.scope === 'personal' ? { scope: body.scope } : {}),
      })
      const result = await serverContext.appData.repositories.fileIngestionJobs.createSourceJob({
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        r2Key: body.r2Key as string,
        fileName: source.name,
        mimeType: body.mimeType as string,
        sizeBytes: body.sizeBytes,
        sourceFileId: source.fileId,
        sourceChecksumSha256: body.checksumSha256 as string,
        ...(typeof body.parentId === 'string' ? { parentId: body.parentId } : {}),
      })
      return NextResponse.json({ ...result, fileId: source.fileId, fileName: source.name, status: 'ready' })
    } catch (error) {
      return fileIngestErrorResponse(error)
    }
  }

  // Only use Convex ingestion jobs when the provider supports it.
  if (serverContext.appDataCapabilities.provider !== 'convex') {
    return NextResponse.json({ error: 'Durable ingestion jobs require Convex provider' }, { status: 501 })
  }

  const result = await serverContext.appData.repositories.fileIngestionJobs.createJob({
    userId: context.auth.userId,
    r2Key: body.r2Key,
    fileName: body.fileName,
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream',
    sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : 0,
    ...(typeof body.parentId === 'string' ? { parentId: body.parentId } : {}),
    ...(context.workspace ? { workspaceId: context.workspace.workspace.id } : {}),
  })

  return NextResponse.json(result)
}

/**
 * Get a single ingestion job's status.
 */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const url = new URL(request.url)
  if (url.searchParams.get('capabilities') === '1') {
    const workspaceId = context.workspace?.workspace?.id ?? ''
    const flags = createReleaseFlags({ userId: context.auth.userId, workspaceId }, [
      'files-file-first', 'files-reading-tools', 'files-hybrid-retrieval', 'harness-file-analysis',
    ])
    const capabilities = await Promise.all([
      flags.isEnabled('files-file-first'), flags.isEnabled('files-reading-tools'),
      flags.isEnabled('files-hybrid-retrieval'), flags.isEnabled('harness-file-analysis'),
    ])
    return NextResponse.json({
      'files-file-first': Boolean(workspaceId && capabilities[0]),
      'files-reading-tools': Boolean(workspaceId && capabilities[1]),
      'files-hybrid-retrieval': Boolean(workspaceId && capabilities[2]),
      'harness-file-analysis': Boolean(workspaceId && capabilities[3]),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  const jobId = url.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const serverContext = getOverlayServerContext()
  if (serverContext.appDataCapabilities.provider !== 'convex') {
    return NextResponse.json({ error: 'Durable ingestion jobs require Convex provider' }, { status: 501 })
  }

  const result = await serverContext.appData.repositories.fileIngestionJobs.getJob({
    jobId,
    userId: context.auth.userId,
  })

  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
