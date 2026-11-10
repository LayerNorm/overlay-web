import assert from 'node:assert/strict'
import test from 'node:test'
import { openSlackConnectState, sealSlackConnectState } from './slack-oauth'

test('Slack installation state is workspace-scoped without agent identity', () => {
  const previous = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'slack-install-fixture'
  try {
    const state = sealSlackConnectState({ workspaceId: 'workspace', userId: 'admin', returnTo: '/app/settings' })
    assert.deepEqual(openSlackConnectState(state), { workspaceId: 'workspace', userId: 'admin', returnTo: '/app/settings' })
    assert.equal('agentId' in JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()), false)
    assert.equal(openSlackConnectState(`${state}tampered`), null)
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = previous
  }
})
