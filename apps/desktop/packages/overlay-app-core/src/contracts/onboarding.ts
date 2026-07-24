export interface OnboardingStatusResponse {
  hasSeenOnboarding: boolean
}

export interface OnboardingCompleteResponse {
  ok: boolean
  persistedToConvex?: boolean
}
