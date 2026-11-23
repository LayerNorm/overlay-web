import assert from 'node:assert/strict'
import test from 'node:test'
import { admitSlackMessage, resumeSlackRequestAfterLink, slackPromptText, type SlackRequester } from './slack-inbound'

const defaults = { whoCanAsk: 'linked', unlinkedPeople: 'link', guests: false, slackConnect: false, actionsInChannels: 'ask' }
const inbound = { teamId: 'T1', channelId: 'C1', threadTs: '1.2', kind: 'channel' as const, external: false, outsider: false, slackUserId: 'U1', text: '<@UBOT> what changed?' }
const member: SlackRequester = { workspaceId: 'w1', settings: defaults, userId: 'user_1', principalId: 'p1', guest: false, allowed: true }

function deps(requester: SlackRequester | null) {
  const calls: string[] = []
  return {
    calls,
    dependencies: {
      resolveRequester: async () => requester,
      resolveThread: async (args: { origin: { channelId: string } }) => {
        calls.push('thread:' + args.origin.channelId)
        return { conversationId: 'conv_1', agentId: 'agent_1', created: true }
      },
      startTurn: async (args: { prompt: string }) => {
        calls.push('turn:' + args.prompt)
        return 'agent_turn_1'
      },
      startDelivery: async (input: { turnId: string }) => { calls.push('deliver:' + input.turnId) },
    },
  }
}

test('mention text drops the bot mention', () => {
  assert.equal(slackPromptText('<@U123ABC> summarize this'), 'summarize this')
  assert.equal(slackPromptText('@Overlay: hi'), 'hi')
  assert.equal(slackPromptText('<@U123>'), '')
})

test('a linked member starts a turn and its delivery', async () => {
  const { calls, dependencies } = deps(member)
  const result = await admitSlackMessage(inbound, dependencies as never)
  assert.deepEqual(result, { status: 'started', conversationId: 'conv_1', turnId: 'agent_turn_1' })
  assert.deepEqual(calls, ['thread:C1', 'turn:what changed?', 'deliver:agent_turn_1'])
})

test('unlinked people, guests, Slack Connect and unknown teams start nothing', async () => {
  for (const [requester, input, status] of [
    [null, inbound, 'not_installed'],
    [{ ...member, userId: null, principalId: null }, inbound, 'link_required'],
    [{ ...member, guest: true }, inbound, 'not_allowed'],
    [member, { ...inbound, external: true }, 'not_allowed'],
    [{ ...member, settings: { ...defaults, slackConnect: true } }, { ...inbound, external: true, outsider: true }, 'not_allowed'],
    [{ ...member, allowed: false }, inbound, 'not_allowed'],
    [member, { ...inbound, text: '<@UBOT>' }, 'empty'],
  ] as const) {
    const { calls, dependencies } = deps(requester)
    const result = await admitSlackMessage(input, dependencies as never)
    assert.equal(result.status, status)
    assert.deepEqual(calls, [])
  }
})

test('people from another organization and people off the list get the matching reason', async () => {
  const outsider = await admitSlackMessage({ ...inbound, external: true, outsider: true }, deps({ ...member, settings: { ...defaults, slackConnect: true } }).dependencies as never)
  assert.deepEqual(outsider, { status: 'not_allowed', reason: 'outsider' })
  const blocked = await admitSlackMessage(inbound, deps({ ...member, allowed: false }).dependencies as never)
  assert.deepEqual(blocked, { status: 'not_allowed', reason: 'not_listed' })
})

test('a question asked before linking runs once the same Slack user links', async () => {
  const { calls, dependencies } = deps(member)
  const keys: string[] = []
  const result = await resumeSlackRequestAfterLink({ teamId: 'T1', slackUserId: 'U1' }, {
    ...dependencies,
    takePending: async (key: string) => { keys.push(key); return inbound },
  } as never)
  assert.equal(result?.status, 'started')
  assert.deepEqual(keys, ['overlay:pending:T1:U1'])
  assert.deepEqual(calls, ['thread:C1', 'turn:what changed?', 'deliver:agent_turn_1'])
})

test('nothing waiting, or a saved request from someone else, starts nothing', async () => {
  const { calls, dependencies } = deps(member)
  assert.equal(await resumeSlackRequestAfterLink({ teamId: 'T1', slackUserId: 'U1' }, { ...dependencies, takePending: async () => null } as never), null)
  assert.equal(await resumeSlackRequestAfterLink({ teamId: 'T1', slackUserId: 'U1' }, {
    ...dependencies, takePending: async () => ({ ...inbound, slackUserId: 'U9' }),
  } as never), null)
  assert.deepEqual(calls, [])
})
