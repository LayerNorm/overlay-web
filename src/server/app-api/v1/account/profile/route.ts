import { NextResponse } from 'next/server'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { downloadBuffer } from '@/server/storage/object-store'
import { resolveIdentityDisplayName, versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'
import {
  identityObjectKey,
  identityUploadError,
  processIdentityImage,
  removeIdentityImage,
  saveIdentityImage,
} from '@/server/identity/profile-media'

type AccountIdentity = {
  userId: string
  email?: string
  name?: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  displayNameOverride?: string
  photoObjectKey?: string
}

export async function GET(_request: Request, context: AccountAppApiRouteContext) {
  try {
    const identity = await getIdentity(context.auth.userId)
    if (!identity) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    return NextResponse.json(toAccountProfile(identity))
  } catch (_error) {
    return NextResponse.json({ error: 'Could not load account profile.' }, { status: 500 })
  }
}

export async function PATCH(_request: Request, context: AccountAppApiRouteContext) {
  const patch: Record<string, unknown> = {}
  const body = context.parsedJson
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
      'auth/users:updateAccountIdentityByServer',
      { serverSecret: getInternalApiSecret(), userId: context.auth.userId, ...patch },
      { throwOnError: true },
    )
    await removeIdentityImage(result?.oldPhotoObjectKey)
    const identity = await getIdentity(context.auth.userId)
    return identity
      ? NextResponse.json(toAccountProfile(identity))
      : NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  } catch (_error) {
    return NextResponse.json({ error: 'Could not update account profile.' }, { status: 500 })
  }
}

export async function uploadPhoto(request: Request, context: AccountAppApiRouteContext) {
  try {
    const currentIdentity = await getIdentity(context.auth.userId)
    if (!currentIdentity) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'An image file is required.' }, { status: 400 })
    const image = await processIdentityImage(file)
    const key = identityObjectKey('accounts', context.auth.userId)
    await saveIdentityImage(key, image)
    let result: { oldPhotoObjectKey: string | null } | null = null
    try {
      result = await lazyConvex.mutation('auth/users:updateAccountIdentityByServer', {
        serverSecret: getInternalApiSecret(),
        userId: context.auth.userId,
        photoObjectKey: key,
      }, { throwOnError: true })
    } catch (error) {
      await removeIdentityImage(key)
      throw error
    }
    await removeIdentityImage(result?.oldPhotoObjectKey)
    const identity = await getIdentity(context.auth.userId)
    return identity
      ? NextResponse.json(toAccountProfile(identity))
      : NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  } catch (error) {
    return identityUploadError(error)
  }
}

export async function GET_PHOTO(request: Request, context: AccountAppApiRouteContext) {
  const targetUserId = new URL(request.url).searchParams.get('userId') || context.auth.userId
  try {
    const photo = await lazyConvex.query<{ photoObjectKey: string } | null>(
      'auth/users:getAccountPhotoByServer',
      { serverSecret: getInternalApiSecret(), actorUserId: context.auth.userId, targetUserId },
      { throwOnError: true },
    )
    if (!photo) return new NextResponse(null, { status: 404 })
    const image = await downloadBuffer(photo.photoObjectKey, 512 * 1024)
    if (!image) return new NextResponse(null, { status: 404 })
    return new NextResponse(new Uint8Array(image), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' },
    })
  } catch (_error) {
    return new NextResponse(null, { status: 404 })
  }
}

async function getIdentity(userId: string) {
  return await lazyConvex.query<AccountIdentity | null>(
    'auth/users:getAccountIdentityByServer',
    { serverSecret: getInternalApiSecret(), userId },
    { throwOnError: true },
  )
}

function toAccountProfile(identity: AccountIdentity) {
  const providerName = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim()
    || identity.name?.trim()
  return {
    displayName: resolveIdentityDisplayName({
      accountOverride: identity.displayNameOverride,
      providerName,
      email: identity.email,
    }),
    photoUrl: identity.photoObjectKey
      ? versionedIdentityUrl(
          `/api/v1/account/profile/photo?userId=${encodeURIComponent(identity.userId)}`,
          identity.photoObjectKey,
        )
      : identity.profilePictureUrl ?? null,
    displayNameOverride: identity.displayNameOverride ?? null,
    hasCustomPhoto: Boolean(identity.photoObjectKey),
    email: identity.email ?? '',
  }
}
