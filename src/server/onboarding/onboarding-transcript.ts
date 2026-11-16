import { onboardingList, type OnboardingAction, type OnboardingStep } from '@/shared/onboarding/session'

export function onboardingAdvanceSummary(
  step: OnboardingStep,
  action: Extract<OnboardingAction, { action: 'advance' }>,
): string {
  if (step === 'employees') return action.agentIds?.length ? `Selected ${action.agentIds.length} AI employee${action.agentIds.length === 1 ? '' : 's'}.` : 'Skipped selecting AI employees.'
  if (step === 'external') return action.agentIds?.length ? 'Saved external agent connections.' : 'Skipped external agent connections.'
  if (step === 'memories') return action.memoryIds?.length ? `Imported ${action.memoryIds.length} Personal context item${action.memoryIds.length === 1 ? '' : 's'}.` : 'Skipped importing Personal context.'
  if (step === 'teammates') return action.invitationIds?.length ? `Invited ${action.invitationIds.length} teammate${action.invitationIds.length === 1 ? '' : 's'}.` : 'Skipped inviting teammates.'
  return 'Finished reviewing optional tool connections.'
}

/** The user's side of the transcript for a v3 step, phrased the way they would say it. */
export function onboardingAdvanceReply(
  step: OnboardingStep,
  done: { agentNames: string[]; invitedEmails: string[]; tools: string[]; memories: boolean },
): string {
  if (step === 'employees') return done.agentNames.length ? `Add ${onboardingList(done.agentNames)}.` : "I'll set up employees later."
  if (step === 'connections') {
    const connected = [...done.tools, ...done.agentNames]
    return connected.length ? `Connected ${onboardingList(connected)}.` : "I'll connect tools later."
  }
  if (step === 'memories') return done.memories ? 'Here is some context from my other assistant.' : 'Not right now.'
  if (step === 'teammates') return done.invitedEmails.length ? `Invite ${onboardingList(done.invitedEmails)}.` : 'Not right now.'
  return 'Not right now.'
}

/** Overlay's acknowledgement before its next question, when the step created something. */
export function onboardingConfirmation(step: OnboardingStep, agentNames: string[], invitedEmails: string[]): string {
  if (step === 'employees' && agentNames.length) return `${onboardingList(agentNames)} ${agentNames.length === 1 ? 'is' : 'are'} on your team.`
  if (step === 'teammates' && invitedEmails.length) return "Invites sent. They'll get an email to join."
  return ''
}
