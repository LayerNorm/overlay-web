import type { OnboardingAction, OnboardingSession, OnboardingSessionResponse } from '@/shared/onboarding/session'
import { fetchWithSessionRecovery } from '@/shared/auth/session-fetch'

export function onboardingRequestInit(session: OnboardingSession, operation: string): RequestInit {
  return { headers: {
    'x-overlay-workspace-id': session.workspaceId,
    'idempotency-key': `onboarding:${session.runId}:${operation}`,
  } }
}

export async function requestOnboarding(workspaceId: string, action?: OnboardingAction, signal?: AbortSignal): Promise<OnboardingSessionResponse> {
  const response = await fetchWithSessionRecovery('/api/v1/onboarding/session', {
    method: action ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-overlay-workspace-id': workspaceId },
    ...(action ? { body: JSON.stringify(action) } : {}),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Could not save your progress. Please try again.')
  return body as OnboardingSessionResponse
}

/** Ends onboarding without finishing it; the workspace opens as usual. */
export async function skipOnboarding(workspaceId: string): Promise<void> {
  const response = await fetchWithSessionRecovery('/api/v1/onboarding/complete', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-overlay-workspace-id': workspaceId },
    body: '{}',
  })
  if (!response.ok) throw new Error('Could not skip setup.')
}
