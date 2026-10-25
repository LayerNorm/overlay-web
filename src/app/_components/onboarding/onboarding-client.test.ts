import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { OnboardingSession } from '@/shared/onboarding/session'
import { onboardingRequestInit } from './onboarding-client'

const session = (runId: string, revision: number): OnboardingSession => ({
  version: 1,
  runId,
  revision,
  workspaceId: 'workspace-1',
  conversationId: 'conversation-1',
  agentId: 'overlay',
  agentPrincipalId: 'overlay-principal',
  step: 'name',
  profile: { name: '', about: '', daily: '' },
  aiEnabled: false,
  reply: { message: 'What shall I call you?', mode: 'prepared' },
  employees: [],
  suggestions: [],
  createdAgentIds: [],
})

test('onboarding resource keys stay stable across revisions and consent toggles', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const first = onboardingRequestInit(session(runId, 1), 'memories')
  const retry = onboardingRequestInit(session(runId, 9), 'memories')
  assert.deepEqual(first, retry)
})

test('onboarding resource keys differ across reset runs', () => {
  const first = onboardingRequestInit(session('11111111-1111-4111-8111-111111111111', 1), 'memories')
  const second = onboardingRequestInit(session('22222222-2222-4222-8222-222222222222', 1), 'memories')
  assert.notEqual((first.headers as Record<string, string>)['idempotency-key'], (second.headers as Record<string, string>)['idempotency-key'])
})
