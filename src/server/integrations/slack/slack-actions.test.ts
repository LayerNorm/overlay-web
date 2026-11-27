import assert from 'node:assert/strict'
import test from 'node:test'
import { answerSlackApproval, continueSlackRequestPrivately } from './slack-actions'

const owner = { origin: { teamId: 'T1', kind: 'channel' as const }, workspaceId: 'w1', agentId: 'a1', userId: 'user_1' }
const requester = { workspaceId: 'w1', settings: { whoCanAsk: 'linked', unlinkedPeople: 'link', slackConnect: false, actionsInChannels: 'ask' }, userId: 'user_1', principalId: 'p1', allowed: true }
const run = { id: 'run_1', approval: { token: 'tok', requestedAt: 1, requests: [] } }
const value = JSON.stringify({ c: 'conv_1', r: 'run_1' })

test('the asker approves through the same path as the web', async () => {
  const submitted: unknown[] = []
  const outcome = await answerSlackApproval({ teamId: 'T1', slackUserId: 'U1', value, approved: true }, {
    resolveRequester: async () => requester,
    threadOwner: async () => owner,
    getLatestAgentRun: async () => run as never,
    submitApproval: (async (args: unknown) => { submitted.push(args); return 'allowed' }) as never,
  })
  assert.equal(outcome, 'approved')
  assert.deepEqual(submitted, [{ actorUserId: 'user_1', workspaceId: 'w1', conversationId: 'conv_1', agentRunId: 'run_1', token: 'tok', decision: { approved: true } }])
})

test('someone else in the channel cannot answer, and unlinked people are asked to link', async () => {
  const submitApproval = (async () => assert.fail('must not submit')) as never
  assert.equal(await answerSlackApproval({ teamId: 'T1', slackUserId: 'U2', value, approved: true }, {
    resolveRequester: async () => ({ ...requester, userId: 'user_2' }), threadOwner: async () => owner, submitApproval,
  }), 'not_owner')
  assert.equal(await answerSlackApproval({ teamId: 'T1', slackUserId: 'U3', value, approved: false }, {
    resolveRequester: async () => ({ ...requester, userId: null }), threadOwner: async () => owner, submitApproval,
  }), 'link_required')
  assert.equal(await answerSlackApproval({ teamId: 'T2', slackUserId: 'U1', value, approved: true }, {
    resolveRequester: async () => requester, threadOwner: async () => owner, submitApproval,
  }), 'not_owner')
  assert.equal(await answerSlackApproval({ teamId: 'T1', slackUserId: 'U1', value: 'not json', approved: true }, { submitApproval }), 'inactive')
})

test('a blocked member cannot use the buttons', async () => {
  const submitApproval = (async () => assert.fail('must not submit')) as never
  assert.equal(await answerSlackApproval({ teamId: 'T1', slackUserId: 'U1', value, approved: true }, {
    resolveRequester: async () => ({ ...requester, allowed: false }), threadOwner: async () => owner, submitApproval,
  }), 'not_allowed')
})

test('a finished approval is reported as no longer waiting', async () => {
  assert.equal(await answerSlackApproval({ teamId: 'T1', slackUserId: 'U1', value, approved: true }, {
    resolveRequester: async () => requester, threadOwner: async () => owner,
    getLatestAgentRun: async () => ({ id: 'run_1' }) as never,
    submitApproval: (async () => assert.fail('must not submit')) as never,
  }), 'inactive')
})

test('continuing privately starts the asker personal chief in a DM thread, by its name', async () => {
  const started: Array<{ agentRole: string; origin: { kind: string; channelId: string; threadTs: string }; prompt: string }> = []
  const posted: string[] = []
  const outcome = await continueSlackRequestPrivately({ teamId: 'T1', slackUserId: 'U1', value: JSON.stringify({ c: 'conv_1' }) }, {
    resolveRequester: async () => requester,
    threadOwner: async () => owner,
    personalChief: async () => ({ name: 'Ada’s Chief' }),
    latestQuestion: async () => 'what is on my calendar?',
    openDm: async (args) => { posted.push(args.markdown); return { channelId: 'D1', threadTs: '9.9' } },
    startRequest: (async (args: (typeof started)[number]) => { started.push(args); return { conversationId: 'conv_2', turnId: 't' } }) as never,
    claim: async () => true,
  })
  assert.equal(outcome, 'private_started')
  assert.equal(started[0]?.agentRole, 'personal_chief')
  assert.deepEqual(started[0]?.origin, { platform: 'slack', teamId: 'T1', channelId: 'D1', threadTs: '9.9', kind: 'dm' })
  assert.equal(started[0]?.prompt, 'what is on my calendar?')
  assert.match(posted[0] ?? '', /^Continuing privately with Ada’s Chief:/)
})

test('a member without a personal chief yet can still continue privately; it is created on the way', async () => {
  const posted: string[] = []
  const outcome = await continueSlackRequestPrivately({ teamId: 'T1', slackUserId: 'U1', value: JSON.stringify({ c: 'conv_1' }) }, {
    resolveRequester: async () => requester, threadOwner: async () => owner,
    personalChief: async () => ({ name: null }),
    latestQuestion: async () => 'q',
    openDm: async (args) => { posted.push(args.markdown); return { channelId: 'D1', threadTs: '9.9' } },
    startRequest: (async () => ({ conversationId: 'conv_2', turnId: 't' })) as never,
    claim: async () => true,
  })
  assert.equal(outcome, 'private_started')
  assert.match(posted[0] ?? '', /^Continuing privately with your Chief:/)
})

test('someone who cannot have a personal chief, or a DM thread, starts nothing', async () => {
  const startRequest = (async () => assert.fail('must not start')) as never
  const base = { resolveRequester: async () => requester, latestQuestion: async () => 'q', openDm: async () => ({ channelId: 'D', threadTs: '1' }), startRequest }
  assert.equal(await continueSlackRequestPrivately({ teamId: 'T1', slackUserId: 'U1', value: JSON.stringify({ c: 'conv_1' }) }, {
    ...base, threadOwner: async () => owner, personalChief: async () => null,
  }), 'no_personal_chief')
  assert.equal(await continueSlackRequestPrivately({ teamId: 'T1', slackUserId: 'U1', value: JSON.stringify({ c: 'conv_1' }) }, {
    ...base, threadOwner: async () => ({ ...owner, origin: { teamId: 'T1', kind: 'dm' as const } }), personalChief: async () => ({ name: 'Ada’s Chief' }),
  }), 'inactive')
})

test('a second click on Ask privately starts nothing more, and a failed start frees the button', async () => {
  const claimed = new Set<string>()
  const claim = async (key: string) => { if (claimed.has(key)) return false; claimed.add(key); return true }
  const release = async (key: string) => { claimed.delete(key) }
  let starts = 0
  const base = {
    resolveRequester: async () => requester, threadOwner: async () => owner, personalChief: async () => ({ name: 'Ada’s Chief' }),
    latestQuestion: async () => 'q', openDm: async () => ({ channelId: 'D1', threadTs: '9.9' }), claim, release,
  }
  const click = (startRequest: unknown) => continueSlackRequestPrivately({ teamId: 'T1', slackUserId: 'U1', value: JSON.stringify({ c: 'conv_1' }) }, {
    ...base, startRequest: startRequest as never,
  })
  await assert.rejects(click(async () => { throw new Error('BUDGET_EXCEEDED') }))
  assert.deepEqual([...claimed], [])
  const ok = async () => { starts += 1; return { conversationId: 'conv_2', turnId: 't' } }
  assert.equal(await click(ok), 'private_started')
  assert.equal(await click(ok), 'private_started')
  assert.equal(starts, 1)
  assert.deepEqual([...claimed], ['private-started:conv_1'])
})
