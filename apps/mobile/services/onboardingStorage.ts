import AsyncStorage from '@react-native-async-storage/async-storage'

const ONBOARDING_STATE_KEY = 'overlay-onboarding-state'

export interface OnboardingState {
  completed: boolean
  displayName: string
  completedAt?: number
}

const DEFAULT_STATE: OnboardingState = {
  completed: false,
  displayName: ''
}

export async function getOnboardingState(): Promise<OnboardingState> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_STATE_KEY)
    if (!raw) return DEFAULT_STATE

    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    return {
      completed: parsed.completed === true,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : undefined
    }
  } catch {
    return DEFAULT_STATE
  }
}

export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state))
}

export async function setOnboardingDisplayName(displayName: string): Promise<void> {
  const current = await getOnboardingState()
  await saveOnboardingState({
    ...current,
    displayName
  })
}

export async function completeOnboarding(displayName: string): Promise<void> {
  await saveOnboardingState({
    completed: true,
    displayName,
    completedAt: Date.now()
  })
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_STATE_KEY)
}
