import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES,
  sandboxRunMaxEgressBytes,
  sandboxRunNetworkPolicy,
} from './run-policy'

test('standalone sandbox denies network access unless domains are explicitly allowed', () => {
  assert.deepEqual(sandboxRunNetworkPolicy({}), { mode: 'deny_all' })
  assert.deepEqual(sandboxRunNetworkPolicy({ OVERLAY_SANDBOX_RUN_ALLOWED_DOMAINS: ' npmjs.org, pypi.org, npmjs.org ' }), {
    mode: 'allowlist',
    domains: ['npmjs.org', 'pypi.org'],
    deniedCidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'],
  })
})

test('blank or invalid egress limits keep the conservative default', () => {
  assert.equal(sandboxRunMaxEgressBytes({}), DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES)
  assert.equal(sandboxRunMaxEgressBytes({ OVERLAY_SANDBOX_RUN_MAX_EGRESS_BYTES: '  ' }), DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES)
  assert.equal(sandboxRunMaxEgressBytes({ OVERLAY_SANDBOX_RUN_MAX_EGRESS_BYTES: '-1' }), DEFAULT_SANDBOX_RUN_MAX_EGRESS_BYTES)
  assert.equal(sandboxRunMaxEgressBytes({ OVERLAY_SANDBOX_RUN_MAX_EGRESS_BYTES: '123.9' }), 123)
})
