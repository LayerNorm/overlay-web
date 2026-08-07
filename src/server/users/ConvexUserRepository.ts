import 'server-only'

import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { UserDirectoryEntry, UserRepository, UserUpsertInput, UserUpsertResult } from './types'

export class ConvexUserRepository implements UserRepository {
  async upsertFromIdentity(input: UserUpsertInput): Promise<UserUpsertResult> {
    const { convex } = await import('@/server/database/convex')
    const syncResult = await convex.mutation<{ success: boolean; isNewUser: boolean }>('auth/users:syncUserProfileByServer', {
      serverSecret: getInternalApiSecret(),
      userId: input.user.id,
      email: input.user.email,
      firstName: input.user.firstName,
      lastName: input.user.lastName,
      profilePictureUrl: input.user.profilePictureUrl,
    }, { throwOnError: true })

    if (!syncResult?.success) {
      throw new Error('Convex user profile sync failed')
    }

    await convex.mutation('platform/uiSettings:upsertByServer', {
      serverSecret: getInternalApiSecret(),
      userId: input.user.id,
    }, { throwOnError: true })

    return {
      success: true,
      isNewUser: syncResult.isNewUser,
      userId: input.user.id,
    }
  }

  async listDirectory(): Promise<UserDirectoryEntry[]> {
    const { convex } = await import('@/server/database/convex')
    const rows = await convex.query<{ id: string; name: string | null; email: string }[]>(
      'auth/users:listDirectoryByServer',
      { serverSecret: getInternalApiSecret() },
    )
    return (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name ?? row.email,
      email: row.email,
    }))
  }
}
