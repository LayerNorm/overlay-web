import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { connectedAgentPolicyFor } from './ConnectedAgentPolicy'

test('connected-agent limits increase monotonically across free, paid, and max plans', () => {
  const free = connectedAgentPolicyFor({ planKind: 'free', tier: 'free' })
  const paid = connectedAgentPolicyFor({ planKind: 'paid', tier: 'pro' })
  const max = connectedAgentPolicyFor({ planKind: 'paid', tier: 'max' })
  for (const key of Object.keys(free) as Array<keyof typeof free>) {
    assert.ok(free[key] <= paid[key], `${key} should not shrink on paid plans`)
    assert.ok(paid[key] <= max[key], `${key} should not shrink on max plans`)
  }
  assert.equal(free.maxEnvironments, 1)
  assert.equal(free.maxConcurrentRuns, 1)
  assert.equal(free.maxSandboxEgressBytes, 0)
})
