import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { isKnownOutputType } from '@/shared/tools/output-types'
import { deleteObject } from '@/server/storage/object-store'
import { isOwnedOutputR2Key } from '@/server/storage/storage-keys'
import { lazyConvex as convex } from '@/server/database/lazy-convex'

type OutputFile = {
  _id: string
  userId: string
  kind?: string
  name: string
  r2Key?: string | null
  mimeType?: string
  sizeBytes?: number
  prompt?: string
  modelId?: string
  outputType?: string
  conversationId?: string
  turnId?: string
  createdAt: number
  updatedAt: number
  legacyOutputId?: string
}

function asOutput(file: OutputFile) {
  const type = file.outputType ?? 'other'
  return {
    _id: file._id,
    fileId: file._id,
    legacyOutputId: file.legacyOutputId,
    userId: file.userId,
    type,
    source: type === 'image' ? 'image_generation' : type === 'video' ? 'video_generation' : 'sandbox',
    status: 'completed',
    prompt: file.prompt ?? file.name,
    modelId: file.modelId ?? '',
    r2Key: file.r2Key ?? undefined,
    url: `/api/v1/files/${file._id}/content`,
    fileName: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    conversationId: file.conversationId,
    turnId: file.turnId,
    createdAt: file.createdAt,
    completedAt: file.updatedAt,
  }
}

async function getCanonicalOutput(args: {
  outputId: string
  userId: string
  serverSecret: string
}): Promise<OutputFile | null> {
  const direct = await convex.query<OutputFile | null>('files/files:get', {
    fileId: args.outputId,
    userId: args.userId,
    serverSecret: args.serverSecret,
  }).catch((_error) => null)
  if (direct?.kind === 'output') return direct
  const migrated = await convex.query<OutputFile | null>('files/files:getByLegacyOutputId', {
    outputId: args.outputId,
    userId: args.userId,
    serverSecret: args.serverSecret,
  }).catch((_error) => null)
  return migrated?.kind === 'output' ? migrated : null
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()
    const { searchParams } = new URL(request.url)
    const rawType = searchParams.get('type')
    const type = rawType && isKnownOutputType(rawType) ? rawType : null
    const conversationId = searchParams.get('conversationId')

    const files = await convex.query<OutputFile[]>('files/files:list', {
      userId: auth.userId,
      serverSecret,
      kind: 'output',
    })
    const outputs = (files ?? [])
      .filter((file) => !conversationId || file.conversationId === conversationId)
      .filter((file) => !type || file.outputType === type)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(asOutput)

    return NextResponse.json(outputs)
  } catch (error) {
    logger.error('[Outputs API] compatibility error:', error)
    return NextResponse.json({ error: 'Failed to fetch outputs' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()
    const outputId = request.nextUrl.searchParams.get('outputId')
    if (!outputId) return NextResponse.json({ error: 'outputId required' }, { status: 400 })

    const output = await getCanonicalOutput({ outputId, userId: auth.userId, serverSecret })
    if (!output) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (output.r2Key) {
      if (!isOwnedOutputR2Key(auth.userId, output.r2Key)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      await deleteObject(output.r2Key)
    }
    await convex.mutation('files/files:remove', {
      fileId: output._id,
      userId: auth.userId,
      serverSecret,
      r2CleanupConfirmed: Boolean(output.r2Key),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[Outputs API] compatibility delete error:', error)
    return NextResponse.json({ error: 'Failed to delete output' }, { status: 500 })
  }
}
