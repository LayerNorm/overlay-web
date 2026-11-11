import assert from 'node:assert/strict'
import test from 'node:test'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'
import { workspaceSetupResponse } from './setup-required'

test('native bootstrap identifies an unconfigured wallet as workspace setup', async () => {
  const response = workspaceSetupResponse(new BillingPayerResolutionError('workspace_wallet_not_configured'), 'access-token')!
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'Workspace setup required', code: 'workspace_setup_required' })
})

test('browser sessions and other authentication paths keep their existing behavior', () => {
  for (const authType of ['session', 'api-key', 'service', undefined]) {
    assert.equal(workspaceSetupResponse(new BillingPayerResolutionError('workspace_wallet_not_configured'), authType), null)
  }
})

test('missing and unrelated failures are not setup states', () => {
  for (const error of [null, new Error('workspace_wallet_not_configured'),
    new BillingPayerResolutionError('billing_account_inactive'), new BillingPayerResolutionError('workspace_wallet_forbidden')]) {
    assert.equal(workspaceSetupResponse(error, 'access-token'), null)
  }
})
