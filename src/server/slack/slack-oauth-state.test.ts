import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { signInstallState, verifyInstallState } from './slack-oauth-state'

const SECRET = 'test-state-secret-with-enough-entropy'
const NOW = 1_800_000_000_000

test('install state round-trips the install claim', () => {
  const state = signInstallState({
    workspaceId: 'workspace-1',
    principalId: 'principal-1',
    directory: 'slack',
    secret: SECRET,
    now: NOW,
  })
  assert.deepEqual(
    verifyInstallState({ state, secret: SECRET, now: NOW }),
    { workspaceId: 'workspace-1', principalId: 'principal-1', directory: 'slack' },
  )
})

test('install state rejects tampering, wrong secrets, and expiry', () => {
  const state = signInstallState({
    workspaceId: 'workspace-1',
    principalId: 'principal-1',
    directory: 'slack',
    secret: SECRET,
    now: NOW,
  })
  assert.throws(() => verifyInstallState({ state: `${state}x`, secret: SECRET, now: NOW }))
  assert.throws(() => verifyInstallState({ state, secret: 'wrong-secret', now: NOW }))
  assert.throws(() => verifyInstallState({ state, secret: SECRET, now: NOW + 11 * 60 * 1_000 }))
  assert.throws(() => verifyInstallState({ state: 'garbage', secret: SECRET, now: NOW }))
})
