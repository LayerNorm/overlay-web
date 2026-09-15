import AsyncStorage from '@react-native-async-storage/async-storage'
import { appJson } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'

/**
 * Onboarding status (`/api/v1/onboarding/*`) plus the per-device "seen" flag.
 *
 * Mirrors the web `OnboardingProvider`: a per-user local flag short-circuits
 * the server check; when it is absent the server's `hasSeenOnboarding`
 * decides, and a true answer is persisted locally so the check costs nothing
 * on later cold starts.
 */

const LOCAL_KEY_PREFIX = 'overlay-onboarding-seen'

function localKey(userId: string): string {
  return `${LOCAL_KEY_PREFIX}:${userId}`
}

export interface OnboardingStatus {
  hasSeenOnboarding: boolean
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return mobileOverlayAppClient.onboarding.status()
}

export async function completeOnboarding(): Promise<void> {
  await mobileOverlayAppClient.onboarding.complete({})
}

export async function resetOnboarding(): Promise<void> {
  const response = await mobileOverlayAppClient.onboarding.resetResponse({})
  if (!response.ok) {
    throw new Error(`Could not reset onboarding (HTTP ${response.status})`)
  }
}

export async function hasSeenOnboardingLocally(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(localKey(userId))) === '1'
}

export async function markOnboardingSeenLocally(userId: string): Promise<void> {
  await AsyncStorage.setItem(localKey(userId), '1')
}

export async function clearOnboardingLocalFlag(userId: string): Promise<void> {
  await AsyncStorage.removeItem(localKey(userId))
}

/**
 * Resolves whether this user still needs the onboarding flow. A local "seen"
 * flag wins; otherwise the server flag decides and is mirrored locally.
 * Failures fail open to "seen" — onboarding must never block app entry.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  if (await hasSeenOnboardingLocally(userId)) return false
  try {
    const status = await getOnboardingStatus()
    if (status.hasSeenOnboarding) {
      await markOnboardingSeenLocally(userId)
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Marks the flow complete both locally and on the server. The local flag is
 * written first so a server failure never re-triggers the flow on this device.
 */
export async function finishOnboarding(userId: string): Promise<void> {
  await markOnboardingSeenLocally(userId)
  try {
    await completeOnboarding()
  } catch {
    // Server persistence is best-effort; the local flag already suppresses the
    // flow on this device and the server flag can be completed on a later run.
  }
}
