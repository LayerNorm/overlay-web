import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { downloadBuffer } from '@/server/storage/object-store'
import { resolveIdentityDisplayName, resolveIdentityPhotoUrl, versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'
import {
  identityObjectKey,
  identityUploadError,
  processIdentityImage,
  removeIdentityImage,
  saveIdentityImage,
} from '@/server/identity/profile-media'

type WorkspaceIdentity = {
  workspaceId: string
  principalId: string
  userId: string
  displayNameOverride: string | null
  photoObjectKey: string | null
  accountDisplayNameOverride: string | null
  accountPhotoObjectKey: string | null
  accountName: string | null
  accountPhotoUrl: string | null
  email: string | null
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  const identity = await getIdentity(context, await workspaceId(context))
  return identity
    ? NextResponse.json(toWorkspaceProfile(identity))
    : NextResponse.json({ error: 'Workspace profile not found.' }, { status: 404 })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const body = context.parsedJson
  const patch: Record<string, unknown> = {}
  if (Object.hasOwn(body, 'displayName')) {
    if (body.displayName !== null && typeof body.displayName !== 'string') {
      return NextResponse.json({ error: 'displayName must be a string or null.' }, { status: 400 })
    }
    const name = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    if (name.length > 80) return NextResponse.json({ error: 'Display name must be 80 characters or fewer.' }, { status: 400 })
    patch.displayNameOverride = name || null
  }
  if (body.resetPhoto !== undefined) {
    if (typeof body.resetPhoto !== 'boolean') return NextResponse.json({ error: 'resetPhoto must be a boolean.' }, { status: 400 })
    if (body.resetPhoto) patch.photoObjectKey = null
  }
  try {
    const result = await lazyConvex.mutation<{ oldPhotoObjectKey: string | null }>(
      'collaboration/workspaces:updateWorkspaceIdentityByServer',
      { serverSecret: getInternalApiSecret(), workspaceId: await workspaceId(context), userId: context.auth.userId, ...patch },
      { throwOnError: true },
    )
    await removeIdentityImage(result?.oldPhotoObjectKey)
    const identity = await getIdentity(context, await workspaceId(context))
    return identity
      ? NextResponse.json(toWorkspaceProfile(identity))
      : NextResponse.json({ error: 'Workspace profile not found.' }, { status: 404 })
  } catch (error) {
    return workspaceProfileError(error)
  }
}

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const workspaceIdValue = await workspaceId(context)
    const authorizedIdentity = await getIdentity(context, workspaceIdValue)
    if (!authorizedIdentity) {
      return NextResponse.json({ error: 'Active workspace membership is required.' }, { status: 403 })
    }
    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'An image file is required.' }, { status: 400 })
    const image = await processIdentityImage(file)
    const key = identityObjectKey('workspaces', `${workspaceIdValue}/${context.auth.userId}`)
    await saveIdentityImage(key, image)
    let result: { oldPhotoObjectKey: string | null } | null = null
    try {
      result = await lazyConvex.mutation('collaboration/workspaces:updateWorkspaceIdentityByServer', {
        serverSecret: getInternalApiSecret(),
        workspaceId: workspaceIdValue,
        userId: context.auth.userId,
        photoObjectKey: key,
      }, { throwOnError: true })
    } catch (error) {
      await removeIdentityImage(key)
      throw error
    }
    await removeIdentityImage(result?.oldPhotoObjectKey)
    const identity = await getIdentity(context, workspaceIdValue)
    return identity
      ? NextResponse.json(toWorkspaceProfile(identity))
      : NextResponse.json({ error: 'Workspace profile not found.' }, { status: 404 })
  } catch (error) {
    return error instanceof Error && error.message.startsWith('IDENTITY_UPLOAD_')
      ? identityUploadError(error)
      : workspaceProfileError(error)
  }
}

export async function GET_PHOTO(request: Request, context: AppApiRouteContext) {
  const principalId = new URL(request.url).searchParams.get('principalId')
  if (!principalId) return new NextResponse(null, { status: 404 })
  try {
    const photo = await lazyConvex.query<{ photoObjectKey: string } | null>(
      'collaboration/workspaces:getWorkspaceProfilePhotoByServer',
      {
        serverSecret: getInternalApiSecret(),
        workspaceId: await workspaceId(context),
        actorUserId: context.auth.userId,
        principalId,
      },
      { throwOnError: true },
    )
    if (!photo) return new NextResponse(null, { status: 404 })
    const image = await downloadBuffer(photo.photoObjectKey, 512 * 1024)
    return image
      ? new NextResponse(new Uint8Array(image), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } })
      : new NextResponse(null, { status: 404 })
  } catch (_error) {
    return new NextResponse(null, { status: 404 })
  }
}

async function getIdentity(context: AppApiRouteContext, id: string) {
  return await lazyConvex.query<WorkspaceIdentity | null>(
    'collaboration/workspaces:getWorkspaceIdentityByServer',
    { serverSecret: getInternalApiSecret(), workspaceId: id, userId: context.auth.userId },
    { throwOnError: true },
  )
}

async function workspaceId(context: AppApiRouteContext) {
  const params = await context.params
  const value = params.workspaceId
  if (typeof value !== 'string' || !value) throw new Error('WORKSPACE_NOT_FOUND')
  return value
}

function toWorkspaceProfile(identity: WorkspaceIdentity) {
  const accountDisplayName = resolveIdentityDisplayName({
    accountOverride: identity.accountDisplayNameOverride,
    providerName: identity.accountName,
    email: identity.email,
  })
  const photoUrl = resolveIdentityPhotoUrl({
    workspacePhotoUrl: identity.photoObjectKey
      ? versionedIdentityUrl(
          `/api/v1/workspaces/${encodeURIComponent(identity.workspaceId)}/profile/photo?principalId=${encodeURIComponent(identity.principalId)}`,
          identity.photoObjectKey,
        )
      : null,
    accountPhotoUrl: identity.accountPhotoObjectKey
      ? versionedIdentityUrl(
          `/api/v1/account/profile/photo?userId=${encodeURIComponent(identity.userId)}`,
          identity.accountPhotoObjectKey,
        )
      : null,
    providerPhotoUrl: identity.accountPhotoUrl,
  })
  return {
    displayName: resolveIdentityDisplayName({
      workspaceOverride: identity.displayNameOverride,
      accountOverride: identity.accountDisplayNameOverride,
      providerName: identity.accountName,
      email: identity.email,
    }),
    photoUrl,
    displayNameOverride: identity.displayNameOverride,
    hasCustomPhoto: Boolean(identity.photoObjectKey),
    email: identity.email ?? '',
    accountDisplayName,
    accountPhotoUrl: resolveIdentityPhotoUrl({
      accountPhotoUrl: identity.accountPhotoObjectKey
        ? versionedIdentityUrl(
            `/api/v1/account/profile/photo?userId=${encodeURIComponent(identity.userId)}`,
            identity.accountPhotoObjectKey,
          )
        : null,
      providerPhotoUrl: identity.accountPhotoUrl,
    }),
  }
}

function workspaceProfileError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const status = message.includes('FORBIDDEN') ? 403 : message.includes('NOT_FOUND') ? 404 : 500
  return NextResponse.json({ error: status === 500 ? 'Could not update workspace profile.' : 'Workspace profile unavailable.' }, { status })
}
