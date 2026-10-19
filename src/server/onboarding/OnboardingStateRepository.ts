import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export type OnboardingStateRecord = {
  hasSeenOnboarding: boolean
  onboardingSession?: string
}

export type OnboardingCommitResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'invalid_state' | 'stale_revision' | 'subscription_not_found'; currentRevision?: number; currentRunId?: string }

export interface OnboardingStateRepository {
  get(userId: string): Promise<OnboardingStateRecord | null>
  compareAndSet(args: {
    userId: string
    expectedRevision: number
    expectedRunId?: string
    onboardingSession?: string
    hasSeenOnboarding: boolean
  }): Promise<OnboardingCommitResult>
  clearOutbox(args: { userId: string; expectedRevision: number; expectedRunId: string; onboardingSession: string }): Promise<boolean>
  reset(userId: string): Promise<boolean>
}

export class ConvexOnboardingStateRepository implements OnboardingStateRepository {
  private get serverSecret() {
    return getInternalApiSecret()
  }

  async get(userId: string) {
    return await convex.query<OnboardingStateRecord | null>('auth/onboarding:getByServer', {
      serverSecret: this.serverSecret,
      userId,
    })
  }

  async compareAndSet(args: Parameters<OnboardingStateRepository['compareAndSet']>[0]) {
    const result = await convex.mutation<OnboardingCommitResult>('auth/onboarding:compareAndSetByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Onboarding compare-and-set returned no result')
    return result
  }

  async clearOutbox(args: Parameters<OnboardingStateRepository['clearOutbox']>[0]) {
    const result = await convex.mutation<boolean>('auth/onboarding:clearOutboxByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return result === true
  }

  async reset(userId: string) {
    const result = await convex.mutation<{ ok: boolean }>('auth/onboarding:resetByServer', {
      serverSecret: this.serverSecret,
      userId,
    }, { throwOnError: true })
    return Boolean(result?.ok)
  }
}
