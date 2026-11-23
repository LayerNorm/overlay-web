import assert from 'node:assert/strict'
import test from 'node:test'
import { mirrorWebMessageToSlack } from './slack-outbound'

process.env.NEXT_PUBLIC_APP_URL ??= 'https://overlay.test'

const origin = { origin: { teamId: 'T1', channelId: 'C1', threadTs: '1.2', kind: 'channel' as const }, workspaceId: 'w1', agentId: 'a1', userId: 'user_1' }
const args = { conversationId: 'conv_1', workspaceId: 'w1', userId: 'user_1', authorName: 'Ada', content: 'Also check **staging**', agentTurns: [{ turnId: 'turn_a', harness: 'overlay' }] }

test('a linked asker web reply is posted under their name and the answer follows it', async () => {
  const posts: Array<{ messages: Array<{ markdown: string }> }> = []
  const deliveries: Array<{ turnId: string; slackUserId: string; kind?: string }> = []
  const mirrored = await mirrorWebMessageToSlack(args, {
    origin: async () => origin,
    link: async () => ({ teamId: 'T1', slackUserId: 'U1' }),
    post: (async (input: (typeof posts)[number]) => { posts.push(input) }) as never,
    startDelivery: async (input) => { deliveries.push(input) },
  })
  assert.equal(mirrored, true)
  assert.match(posts[0]!.messages[0]!.markdown, /^\*\*Ada replied in Overlay\*\*/)
  assert.match(posts[0]!.messages[0]!.markdown, /staging/)
  assert.deepEqual(deliveries.map((delivery) => [delivery.turnId, delivery.slackUserId, delivery.kind]), [['turn_a', 'U1', 'channel']])
})

test('threads from elsewhere, other people and unlinked members are not mirrored', async () => {
  const post = (async () => assert.fail('must not post')) as never
  const startDelivery = async () => assert.fail('must not deliver')
  const link = async () => ({ teamId: 'T1', slackUserId: 'U1' })
  assert.equal(await mirrorWebMessageToSlack(args, { origin: async () => null, link, post, startDelivery }), false)
  assert.equal(await mirrorWebMessageToSlack(args, { origin: async () => ({ ...origin, userId: 'user_2' }), link, post, startDelivery }), false)
  assert.equal(await mirrorWebMessageToSlack(args, { origin: async () => origin, link: async () => null, post, startDelivery }), false)
  assert.equal(await mirrorWebMessageToSlack(args, { origin: async () => origin, link: async () => ({ teamId: 'T9', slackUserId: 'U1' }), post, startDelivery }), false)
})

test('a message only outside agents answer is not mirrored, since no Overlay run follows it', async () => {
  const post = (async () => assert.fail('must not post')) as never
  const startDelivery = async () => assert.fail('must not deliver')
  assert.equal(await mirrorWebMessageToSlack({ ...args, agentTurns: [{ turnId: 'turn_m', harness: 'mcp' }] }, {
    origin: async () => origin, link: async () => ({ teamId: 'T1', slackUserId: 'U1' }), post, startDelivery,
  }), false)
})

test('only turns Overlay runs are followed into Slack', async () => {
  const deliveries: string[] = []
  await mirrorWebMessageToSlack({ ...args, agentTurns: [{ turnId: 'turn_m', harness: 'mcp' }, { turnId: 'turn_a' }] }, {
    origin: async () => origin, link: async () => ({ teamId: 'T1', slackUserId: 'U1' }),
    post: (async () => undefined) as never, startDelivery: async (input) => { deliveries.push(input.turnId) },
  })
  assert.deepEqual(deliveries, ['turn_a'])
})
