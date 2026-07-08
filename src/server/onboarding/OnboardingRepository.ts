import 'server-only'

export interface OnboardingStatus {
  hasSeenOnboarding: boolean
}

export interface OnboardingCompleteResult {
  ok: true
  persistedToPostgres?: boolean
}

export interface OnboardingRepository {
  getStatus(userId: string): Promise<OnboardingStatus>
  markComplete(userId: string): Promise<OnboardingCompleteResult>
  reset(userId: string): Promise<{ ok: boolean }>
}
