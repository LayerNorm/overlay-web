import type { OnboardingSession } from '@/shared/onboarding/session'

function key(session: OnboardingSession) {
  return `overlay:onboarding-draft:v1:${session.workspaceId}:${session.runId}:${session.step}`
}

export function readOnboardingDraft(session: OnboardingSession): string {
  try {
    const saved = window.sessionStorage.getItem(key(session))
    if (saved !== null && saved.length <= 3000) return saved
  } catch { /* Drafts remain usable when browser storage is unavailable. */ }
  const profile = session.profile
  if (session.step === 'name') return profile.name
  if (session.step === 'about' || session.step === 'daily' || session.step === 'team' || session.step === 'website') return profile[session.step] ?? ''
  return ''
}

export function writeOnboardingDraft(session: OnboardingSession, value: string) {
  try { window.sessionStorage.setItem(key(session), value.slice(0, 3000)) } catch { /* Storage is optional. */ }
}
