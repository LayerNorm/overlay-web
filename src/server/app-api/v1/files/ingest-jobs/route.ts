import { NextResponse, type NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

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

  // Only use Convex ingestion jobs when the provider supports it.
  if (serverContext.appDataCapabilities.provider !== 'convex') {
    return NextResponse.json({ error: 'Durable ingestion jobs require Convex provider' }, { status: 501 })
  }

  const result = await convex.mutation<{ jobId: string }>('files/ingestion/jobs:createJob', {
    userId: context.auth.userId,
    r2Key: body.r2Key,
    fileName: body.fileName,
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream',
    sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : 0,
    ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
    ...(typeof body.parentId === 'string' ? { parentId: body.parentId } : {}),
    ...(context.workspace ? { workspaceId: context.workspace.workspace.id } : {}),
    serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })

  return NextResponse.json(result)
}

/**
 * Get a single ingestion job's status.
 */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const serverContext = getOverlayServerContext()
  if (serverContext.appDataCapabilities.provider !== 'convex') {
    return NextResponse.json({ error: 'Durable ingestion jobs require Convex provider' }, { status: 501 })
  }

  const result = await convex.query<{
    _id: string
    status: string
    statusMessage?: string
    fileName: string
    partCount?: number
    fileIds?: string[]
    error?: string
    createdAt: number
    updatedAt: number
    completedAt?: number
  } | null>('files/ingestion/jobs:getJob', {
    jobId: jobId as never,
    userId: context.auth.userId,
    serverSecret: getInternalApiSecret(),
  }, { throwOnError: false })

  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
