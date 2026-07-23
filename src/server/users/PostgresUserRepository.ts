import 'server-only'

import { and, eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  authIdentities,
  onboardingState,
  users,
  userSettings,
} from '@/server/database/postgres/schema'
import type { UserDirectoryEntry, UserRepository, UserUpsertInput, UserUpsertResult } from './types'

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async upsertFromIdentity(input: UserUpsertInput): Promise<UserUpsertResult> {
    const name = displayName(input.user)

    return await this.db.transaction(async (tx) => {
      const [existingIdentity] = await tx
        .select({ userId: authIdentities.userId })
        .from(authIdentities)
        .where(and(
          eq(authIdentities.provider, input.identity.provider),
          eq(authIdentities.subject, input.identity.subject),
        ))
        .limit(1)

      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.user.id))
        .limit(1)

      const isNewUser = !existingIdentity && !existingUser

      await tx
        .insert(users)
        .values({
          id: input.user.id,
          email: input.user.email,
          name,
          firstName: input.user.firstName,
          lastName: input.user.lastName,
          profilePictureUrl: input.user.profilePictureUrl,
          emailVerified: input.user.emailVerified ?? false,
          createdAt: input.now,
          updatedAt: input.now,
          lastLoginAt: input.now,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: input.user.email,
            name,
            firstName: input.user.firstName,
            lastName: input.user.lastName,
            profilePictureUrl: input.user.profilePictureUrl,
            emailVerified: input.user.emailVerified ?? false,
            updatedAt: input.now,
            lastLoginAt: input.now,
          },
        })

      await tx
        .insert(authIdentities)
        .values({
          provider: input.identity.provider,
          subject: input.identity.subject,
          userId: input.user.id,
          email: input.identity.email,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [authIdentities.provider, authIdentities.subject],
          set: {
            userId: input.user.id,
            email: input.identity.email,
            updatedAt: input.now,
          },
        })

      await tx
        .insert(userSettings)
        .values({
          userId: input.user.id,
          theme: 'light',
          lightThemePreset: 'default-light',
          darkThemePreset: 'default-dark',
          useSecondarySidebar: false,
          chatStreamingMode: 'token',
          autoContinue: false,
          defaultChatMode: 'act',
          modelPreference: 'same-for-each-chat',
          defaultAskModelIds: [],
          sendWithEnter: true,
          attachFilesToKnowledgeByDefault: false,
          onlyAllowZdrModels: false,
          dismissedZdrWarningGlobally: false,
          dismissedZdrWarningModelIds: [],
          enabledChatModelIds: [],
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing()

      await tx
        .insert(onboardingState)
        .values({
          userId: input.user.id,
          hasSeenOnboarding: false,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing()

      return {
        success: true,
        isNewUser,
        userId: input.user.id,
      }
    })
  }

  async listDirectory(): Promise<UserDirectoryEntry[]> {
    return await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        profilePictureUrl: users.profilePictureUrl,
      })
      .from(users)
      .orderBy(users.email, users.id)
      .then((rows) => rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name ?? undefined,
        profilePictureUrl: row.profilePictureUrl ?? undefined,
      })))
  }
}

function displayName(user: UserUpsertInput['user']): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return name || user.email
}
