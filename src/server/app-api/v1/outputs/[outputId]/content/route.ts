import { logger } from '@/server/observability/logger'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { generatePresignedDownloadUrl } from '@/server/storage/object-store'
import { isOwnedOutputR2Key } from '@/server/storage/storage-keys'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  const { auth } = context

  const { outputId } = await context.params as { outputId: string }
  const serverSecret = getInternalApiSecret()
  const proxyTarget = await convex.query<{ r2Key?: string; url?: string; sizeBytes: number; type: string; fileName?: string; mimeType?: string } | null>(
    'outputs/outputs:getStorageUrlForProxy',
    {
      outputId,
      userId: auth.userId,
      serverSecret,
    },
    { throwOnError: true },
  )

  if (!proxyTarget) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (proxyTarget.r2Key) {
    if (!isOwnedOutputR2Key(auth.userId, proxyTarget.r2Key)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    await convex.mutation('platform/usage:recordFileBandwidthByServer', {
      serverSecret,
      userId: auth.userId,
      bytes: proxyTarget.sizeBytes ?? 0,
    }).catch((error) => logger.warn('[outputs/content] bandwidth accounting failed', error))
    const presignedUrl = await generatePresignedDownloadUrl(proxyTarget.r2Key)
    return Response.redirect(presignedUrl, 302)
  }

  if (proxyTarget.url) {
    const upstream = await fetch(proxyTarget.url)
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Failed to load stored asset.' }, { status: 502 })
    }
    const headers = new Headers()
    const ct = upstream.headers.get('content-type')
    if (ct) headers.set('content-type', ct)
    const cd = upstream.headers.get('content-disposition')
    if (cd) headers.set('content-disposition', cd)
    return new Response(upstream.body, { status: 200, headers })
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}
