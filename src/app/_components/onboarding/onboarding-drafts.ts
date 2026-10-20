import type { OnboardingSession } from '@/shared/onboarding/session'

function key(session: OnboardingSession, userId: string) {
  return `overlay:onboarding-draft:v1:${userId}:${session.workspaceId}:${session.runId}:${session.step}`
}

export function readOnboardingDraft(session: OnboardingSession, userId: string, initialName: string): string {
  try {
    const saved = window.sessionStorage.getItem(key(session, userId))
    if (saved !== null && saved.length <= 3000) return saved
  } catch { /* Drafts remain usable when browser storage is unavailable. */ }
  const profile = session.profile
  if (session.step === 'name') return profile.name || initialName
  if (session.step === 'about' || session.step === 'daily' || session.step === 'team' || session.step === 'website') return profile[session.step] ?? ''
  return ''
}

export function writeOnboardingDraft(session: OnboardingSession, userId: string, value: string) {
  try { window.sessionStorage.setItem(key(session, userId), value.slice(0, 3000)) } catch { /* Storage is optional. */ }
}
