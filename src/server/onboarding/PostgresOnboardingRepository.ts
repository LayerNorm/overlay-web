import 'server-only'

import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { onboardingState } from '@/server/database/postgres/schema'
import type {
  OnboardingCompleteResult,
  OnboardingRepository,
  OnboardingStatus,
} from './OnboardingRepository'

export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getStatus(userId: string): Promise<OnboardingStatus> {
    const [row] = await this.db
      .select({ hasSeenOnboarding: onboardingState.hasSeenOnboarding })
      .from(onboardingState)
      .where(eq(onboardingState.userId, userId))
      .limit(1)
    return { hasSeenOnboarding: Boolean(row?.hasSeenOnboarding) }
  }

  async markComplete(userId: string): Promise<OnboardingCompleteResult> {
    const now = new Date()
    await this.db
      .insert(onboardingState)
      .values({
        userId,
        hasSeenOnboarding: true,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: onboardingState.userId,
        set: {
          hasSeenOnboarding: true,
          completedAt: now,
          resetAt: null,
          updatedAt: now,
        },
      })
    return { ok: true, persistedToPostgres: true }
  }

  async reset(userId: string): Promise<{ ok: boolean }> {
    const now = new Date()
    await this.db
      .insert(onboardingState)
      .values({
        userId,
        hasSeenOnboarding: false,
        resetAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: onboardingState.userId,
        set: {
          hasSeenOnboarding: false,
          completedAt: null,
          resetAt: now,
          updatedAt: now,
        },
      })
    return { ok: true }
  }
}
