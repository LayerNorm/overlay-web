import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBillingProgrammaticSubjectId,
  getTrustedAutomationBillingSubjectId,
  type AppApiRouteContext,
} from './bff-context'

function context(authType: 'api-key' | 'service' | 'session', automationId?: string): AppApiRouteContext {
  return {
    auth: {
      authType,
      userId: 'user_1',
      ...(authType === 'api-key' ? { apiKeyId: 'key_1' } : {}),
    },
    parsedJson: automationId ? { automationId } : {},
  } as AppApiRouteContext
}

test('only service-authenticated internal calls may supply an automation billing subject', () => {
  assert.equal(getTrustedAutomationBillingSubjectId(context('session', 'auto_1')), undefined)
  assert.equal(getTrustedAutomationBillingSubjectId(context('api-key', 'auto_1')), undefined)
  assert.equal(getTrustedAutomationBillingSubjectId(context('service', 'auto_1')), 'automation:auto_1')
})

test('API keys remain the fallback programmatic payer subject', () => {
  assert.equal(getBillingProgrammaticSubjectId(context('api-key')), 'api-key:key_1')
  assert.equal(getBillingProgrammaticSubjectId(context('session')), undefined)
})
