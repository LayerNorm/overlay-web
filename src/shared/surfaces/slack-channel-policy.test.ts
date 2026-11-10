import assert from 'node:assert/strict'
import test from 'node:test'
import { isSupportedSlackChannel } from './slack-channel-policy'
import { slackSurfaceTurnId, isPersistedSlackTurnIdentity } from './surface-turn-identity'

test('only public, non-shared Slack channels are accepted', () => {
  assert.equal(isSupportedSlackChannel({ is_channel: true, is_private: false, is_shared: false }), true)
  assert.equal(isSupportedSlackChannel({ is_channel: true }), false)
  for (const channel of [undefined, {}, { is_im: true }, { is_mpim: true },
    { is_channel: true, is_private: true }, { is_channel: true, is_shared: true },
    { is_channel: true, is_ext_shared: true }, { is_channel: true, is_org_shared: true },
    { is_channel: true, is_pending_ext_shared: true }, { is_channel: true, pending_shared: ['T'] },
    { is_channel: true, is_archived: true }]) {
    assert.equal(isSupportedSlackChannel(channel), false, JSON.stringify(channel))
  }
})

test('Slack turn identity is stable across rebindings and distinct across teams and channels', () => {
  const source = { teamId: 'T', channelId: 'C', messageId: '123.456', bindingId: 'before' }
  const rebound = { ...source, bindingId: 'after' }
  assert.equal(slackSurfaceTurnId(source), slackSurfaceTurnId(rebound))
  assert.notEqual(slackSurfaceTurnId(source), slackSurfaceTurnId({ ...source, channelId: 'C2' }))
  assert.notEqual(slackSurfaceTurnId(source), slackSurfaceTurnId({ ...source, teamId: 'T2' }))
  assert.equal(isPersistedSlackTurnIdentity({ ...source, turnId: 'surface:slack:before:123.456' }), true)
  assert.equal(isPersistedSlackTurnIdentity({ ...source, turnId: 'other' }), false)
})
