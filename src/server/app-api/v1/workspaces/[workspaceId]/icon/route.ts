import { NextResponse } from 'next/server'
import { canManageWorkspace } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { downloadBuffer } from '@/server/storage/object-store'
import { versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'
import {
  identityObjectKey,
  identityUploadError,
  processIdentityImage,
  removeIdentityImage,
  saveIdentityImage,
} from '@/server/identity/profile-media'

type IconMutationResult = { oldIconObjectKey: string | null }

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = await getWorkspaceId(context)
    const icon = await lazyConvex.query<{ iconObjectKey: string } | null>(
      'collaboration/workspaces:getWorkspaceIconByServer',
      { serverSecret: getInternalApiSecret(), workspaceId, actorUserId: context.auth.userId },
      { throwOnError: true },
    )
    if (!icon) return new NextResponse(null, { status: 404 })
    const image = await downloadBuffer(icon.iconObjectKey, 512 * 1024)
    return image
      ? new NextResponse(new Uint8Array(image), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } })
      : new NextResponse(null, { status: 404 })
  } catch (_error) {
    return new NextResponse(null, { status: 404 })
  }
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const preset = context.parsedJson.preset
  if (preset !== null && (typeof preset !== 'string' || !/^shape-[1-6]$/.test(preset))) {
    return NextResponse.json({ error: 'Unknown workspace icon preset.' }, { status: 400 })
  }
  try {
    const result = await lazyConvex.mutation<IconMutationResult>(
      'collaboration/workspaces:updateWorkspaceIconByServer',
      {
        serverSecret: getInternalApiSecret(),
        workspaceId: await getWorkspaceId(context),
        actorUserId: context.auth.userId,
        preset,
      },
      { throwOnError: true },
    )
    await removeIdentityImage(result?.oldIconObjectKey)
    return NextResponse.json({ iconPreset: preset, iconUrl: null })
  } catch (error) {
    return iconError(error)
  }
}

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = await getWorkspaceId(context)
    const access = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(
      context.auth.userId,
      workspaceId,
    )
    if (!canManageWorkspace(access.membership.role)) {
      return NextResponse.json({ error: 'Workspace owner or admin access is required.' }, { status: 403 })
    }
    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'An image file is required.' }, { status: 400 })
    const image = await processIdentityImage(file)
    const key = identityObjectKey('workspace-icons', workspaceId)
    await saveIdentityImage(key, image)
    let result: IconMutationResult | null = null
    try {
      result = await lazyConvex.mutation('collaboration/workspaces:updateWorkspaceIconByServer', {
        serverSecret: getInternalApiSecret(),
        workspaceId,
        actorUserId: context.auth.userId,
        iconObjectKey: key,
      }, { throwOnError: true })
    } catch (error) {
      await removeIdentityImage(key)
      throw error
    }
    await removeIdentityImage(result?.oldIconObjectKey)
    return NextResponse.json({
      iconUrl: versionedIdentityUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/icon`, key),
      iconPreset: null,
    })
  } catch (error) {
    return error instanceof Error && error.message.startsWith('IDENTITY_UPLOAD_')
      ? identityUploadError(error)
      : iconError(error)
  }
}

async function getWorkspaceId(context: AppApiRouteContext) {
  const value = (await context.params).workspaceId
  if (typeof value !== 'string' || !value) throw new Error('WORKSPACE_NOT_FOUND')
  return value
}

function iconError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const status = message.includes('FORBIDDEN') ? 403 : message.includes('NOT_FOUND') ? 404 : 500
  return NextResponse.json({ error: status === 500 ? 'Could not update workspace icon.' : 'Workspace icon unavailable.' }, { status })
}
