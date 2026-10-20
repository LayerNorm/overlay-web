import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanOnboardingReply, ONBOARDING_MODEL, onboardingPrompt } from './onboarding-personalization'

test('personalization uses the shared free router rather than a pinned provider model', () => {
  assert.equal(ONBOARDING_MODEL, 'overlay-free')
})

test('prompt includes only the three allowed profile fields', () => {
  const profile = { name: 'Dev', about: 'Software engineer', daily: 'Review changes', memories: 'Private context', emails: ['private@example.com'] }
  const prompt = onboardingPrompt('employees', profile)!
  assert.deepEqual(JSON.parse(prompt.prompt), { name: profile.name, about: profile.about, daily: profile.daily })
  assert.equal(onboardingPrompt('memories', profile), null)
  assert.equal(onboardingPrompt('teammates', profile), null)
})

test('employee and task output requires exactly two bounded recommendations', () => {
  assert.throws(() => cleanOnboardingReply({ message: 'Suggestions' }, 'employees'))
  assert.throws(() => cleanOnboardingReply({ message: 'Suggestions', suggestions: ['One'] }, 'task'))
  assert.throws(() => cleanOnboardingReply({ message: 'Suggestions', suggestions: ['One', 'Two'], action: 'create' }, 'task'))
  const reply = cleanOnboardingReply({ message: 'Hello\u2014Dev', employees: [{ name: 'Spec', role: 'Draft specs.' }, { name: 'Scout', role: 'Prepare briefs.' }] }, 'employees')
  assert.equal(reply.mode, 'live')
  assert.equal(reply.message, 'Hello,Dev')
  assert.equal(reply.employees?.length, 2)
})
