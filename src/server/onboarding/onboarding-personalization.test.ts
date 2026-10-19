import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanOnboardingReply, hasVerifiedFreePricing, ONBOARDING_MODEL, onboardingPrompt } from './onboarding-personalization'

test('only explicit zero prices on the exact MiniMax model permit personalization', () => {
  const model = (pricing: unknown, id = ONBOARDING_MODEL) => ({ id, pricing })
  assert.equal(hasVerifiedFreePricing(model({ input: '0', output: 0, cached_input: '0', varies_by_provider: false })), true)
  for (const pricing of [{ input: '0' }, { input: null, output: '0' }, { input: '', output: '0' }, { input: false, output: '0' }, { input: '0', output: '.001' }, { input: '0', output: '0', request: '.01' }, { input: '0', output: '0', varies_by_provider: true }, { input: '0', output: '0', unknown: {} }]) {
    assert.equal(hasVerifiedFreePricing(model(pricing)), false)
  }
  assert.equal(hasVerifiedFreePricing({ id: 'another/model', pricing: { input: 0, output: 0 } }), false)
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
