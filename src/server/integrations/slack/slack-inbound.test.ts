import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitSlackMessage, handleSlackTokensRevoked, resumeSlackRequestAfterLink, slackPromptText, type SlackRequester,
} from './slack-inbound'

process.env.NEXT_PUBLIC_APP_URL ??= 'https://overlay.test'

const defaults = { whoCanAsk: 'linked', unlinkedPeople: 'link', slackConnect: false, actionsInChannels: 'ask' }
const inbound = { teamId: 'T1', channelId: 'C1', threadTs: '1.2', kind: 'channel' as const, external: false, outsider: false, slackUserId: 'U1', text: 'what changed?' }
const member: SlackRequester = { workspaceId: 'w1', settings: defaults, userId: 'user_1', principalId: 'p1', allowed: true }

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

test('the prompt drops only the bot mention and keeps links, people and channels readable', () => {
  assert.equal(slackPromptText('<@UBOT> summarize this', { botUserId: 'UBOT' }), 'summarize this')
  assert.equal(slackPromptText('<@UBOT>: hi', { botUserId: 'UBOT' }), 'hi')
  assert.equal(slackPromptText('<@UBOT>', { botUserId: 'UBOT' }), '')
  assert.equal(
    slackPromptText('<@UBOT> read <https://example.com/a?b=1&amp;c=2|the spec> and <https://example.com/raw>', { botUserId: 'UBOT' }),
    'read [the spec](https://example.com/a?b=1&c=2) and https://example.com/raw',
  )
  assert.equal(
    slackPromptText('ask <@U2> and <@U3|bob> in <#C1|general>, mail <mailto:a@b.co|a@b.co>', { botUserId: 'UBOT', names: new Map([['U2', 'Ada']]) }),
    'ask @Ada and @bob in #general, mail a@b.co',
  )
  assert.equal(slackPromptText('who is <@U9>?', { botUserId: 'UBOT' }), 'who is <@U9>?')
  assert.equal(slackPromptText('tell <!here> 1 &lt; 2', { botUserId: 'UBOT' }), 'tell @here 1 < 2')
  assert.equal(slackPromptText('line one\n  <@UBOT> line two', { botUserId: 'UBOT' }), 'line one\nline two')
})

test('a linked member starts a turn and its delivery', async () => {
  const { calls, dependencies } = deps(member)
  const result = await admitSlackMessage(inbound, dependencies as never)
  assert.deepEqual(result, { status: 'started', conversationId: 'conv_1', turnId: 'agent_turn_1' })
  assert.deepEqual(calls, ['thread:C1', 'turn:what changed?', 'deliver:agent_turn_1'])
})

test('unlinked people, Slack Connect and unknown teams start nothing', async () => {
  for (const [requester, input, status] of [
    [null, inbound, 'not_installed'],
    [{ ...member, userId: null, principalId: null }, inbound, 'link_required'],
    [member, { ...inbound, external: true }, 'not_allowed'],
    [{ ...member, settings: { ...defaults, slackConnect: true } }, { ...inbound, external: true, outsider: true }, 'not_allowed'],
    [{ ...member, allowed: false }, inbound, 'not_allowed'],
    [member, { ...inbound, text: '  ' }, 'empty'],
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

test('a request that cannot start tells the asker where to see why', async () => {
  const { dependencies } = deps(member)
  const turnFails = await admitSlackMessage(inbound, { ...dependencies, startTurn: async () => { throw new Error('BUDGET_EXCEEDED') } } as never)
  assert.equal(turnFails.status, 'start_failed')
  assert.match((turnFails as { openUrl: string }).openUrl, /^https?:\/\/[^/]+\/app\/w\/w1\/.*id=conv_1/)
  const noThread = await admitSlackMessage(inbound, { ...dependencies, resolveThread: async () => { throw new Error('SLACK_WORKSPACE_OVERLAY_MISSING') } } as never)
  assert.equal(noThread.status, 'start_failed')
  assert.match((noThread as { openUrl: string }).openUrl, /^https?:\/\/[^/]+\/app\/w\/w1\/agents$/)
})

test('a question asked before linking that is now refused is answered with the reason, only to the asker', async () => {
  const { calls, dependencies } = deps({ ...member, allowed: false })
  const notices: Array<{ channelId: string; threadTs?: string; slackUserId: string; markdown: string }> = []
  const notify = async (notice: (typeof notices)[number]) => { notices.push(notice) }
  // A new top-level question has no Slack thread yet, so the note goes to the channel, where Slack shows it.
  const result = await resumeSlackRequestAfterLink({ teamId: 'T1', slackUserId: 'U1' }, {
    ...dependencies, takePending: async () => inbound, notify,
  } as never)
  assert.equal(result?.status, 'not_allowed')
  assert.deepEqual(calls, [])
  assert.equal(notices.length, 1)
  assert.deepEqual([notices[0]!.channelId, notices[0]!.threadTs, notices[0]!.slackUserId], ['C1', undefined, 'U1'])
  assert.match(notices[0]!.markdown, /can’t ask Overlay in Slack/)
  // Asked inside a thread: the note goes into that thread.
  await resumeSlackRequestAfterLink({ teamId: 'T1', slackUserId: 'U1' }, {
    ...dependencies, takePending: async () => ({ ...inbound, inThread: true }), notify,
  } as never)
  assert.equal(notices[1]!.threadTs, '1.2')
})

test('a revoked bot token removes the installation; revoked user tokens and other events do not', async () => {
  const removed: string[] = []
  const uninstall = async (teamId: string) => { removed.push(teamId) }
  const event = (tokens: unknown) => JSON.stringify({ type: 'event_callback', team_id: 'T1', event: { type: 'tokens_revoked', tokens } })
  assert.equal(await handleSlackTokensRevoked(event({ bot: ['UBOT'] }), uninstall), true)
  assert.equal(await handleSlackTokensRevoked(event({ oauth: ['U1'] }), uninstall), false)
  assert.equal(await handleSlackTokensRevoked(JSON.stringify({ type: 'event_callback', team_id: 'T1', event: { type: 'app_mention' } }), uninstall), false)
  assert.equal(await handleSlackTokensRevoked('not json', uninstall), false)
  assert.deepEqual(removed, ['T1'])
})
