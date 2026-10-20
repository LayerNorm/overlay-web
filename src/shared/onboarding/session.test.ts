import assert from 'node:assert/strict'
import test from 'node:test'
import { onboardingChoices } from './session'

test('onboarding name does not offer an auth-derived draft choice', () => {
  assert.deepEqual(onboardingChoices({ step: 'name', suggestions: [] }), [])
})
