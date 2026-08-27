import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HostedProviderAccessDisabledError,
  assertHostedProviderAccessEnabled,
  isHostedProviderAccessDisabled,
} from './hosted-provider-kill-switch'

test('hosted provider access fails closed unless explicitly enabled', () => {
  assert.equal(isHostedProviderAccessDisabled({}), true)
  assert.equal(isHostedProviderAccessDisabled({ OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED: '0' }), true)
  assert.equal(isHostedProviderAccessDisabled({ OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED: 'true' }), true)
  assert.equal(isHostedProviderAccessDisabled({ OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED: '1' }), false)
})

test('hosted provider emergency kill switch overrides explicit access', () => {
  const env = {
    OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED: '1',
    OVERLAY_HOSTED_PROVIDER_KILL_SWITCH: '1',
  }
  assert.equal(isHostedProviderAccessDisabled(env), true)
  assert.throws(
    () => assertHostedProviderAccessEnabled(env),
    (error: unknown) =>
      error instanceof HostedProviderAccessDisabledError &&
      error.code === 'hosted_provider_access_disabled',
  )
})
