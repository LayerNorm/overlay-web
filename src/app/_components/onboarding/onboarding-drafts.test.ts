import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { OnboardingSession } from '@/shared/onboarding/session'
import { readOnboardingDraft, writeOnboardingDraft } from './onboarding-drafts'

const session: OnboardingSession = {
  version: 1,
  runId: '11111111-1111-4111-8111-111111111111',
  revision: 1,
  workspaceId: 'workspace-1',
  conversationId: 'conversation-1',
  agentId: 'overlay',
  agentPrincipalId: 'overlay-principal',
  step: 'about',
  profile: { name: '', about: '', daily: '' },
  aiEnabled: false,
  reply: { message: 'Tell me a bit about yourself.', mode: 'prepared' },
  employees: [],
  suggestions: [],
  createdAgentIds: [],
}

test('onboarding drafts persist within their workspace and run scope', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  })

  try {
    writeOnboardingDraft(session, 'Unsaved profile')
    assert.equal(readOnboardingDraft(session), 'Unsaved profile')
    assert.equal(readOnboardingDraft({ ...session, runId: '22222222-2222-4222-8222-222222222222' }), '')
    assert.equal(readOnboardingDraft({ ...session, step: 'name' }), '')
    writeOnboardingDraft({ ...session, step: 'name' }, 'Ada')
    assert.equal(readOnboardingDraft({ ...session, step: 'name' }), 'Ada')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
