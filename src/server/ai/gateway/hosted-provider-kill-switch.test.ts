import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HostedProviderAccessDisabledError,
  assertHostedProviderAccessEnabled,
  isHostedProviderAccessDisabled,
} from './hosted-provider-kill-switch'

test('hosted provider kill switch is off unless explicitly set to 1', () => {
  assert.equal(isHostedProviderAccessDisabled({}), false)
  assert.equal(isHostedProviderAccessDisabled({ OVERLAY_HOSTED_PROVIDER_KILL_SWITCH: '0' }), false)
  assert.equal(isHostedProviderAccessDisabled({ OVERLAY_HOSTED_PROVIDER_KILL_SWITCH: 'true' }), false)
})

test('hosted provider kill switch fails closed when set to 1', () => {
  const env = { OVERLAY_HOSTED_PROVIDER_KILL_SWITCH: '1' }
  assert.equal(isHostedProviderAccessDisabled(env), true)
  assert.throws(
    () => assertHostedProviderAccessEnabled(env),
    (error: unknown) =>
      error instanceof HostedProviderAccessDisabledError &&
      error.code === 'hosted_provider_access_disabled',
  )
})
