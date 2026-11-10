import assert from 'node:assert/strict'
import test from 'node:test'
import type { SlackAdapter } from '@chat-adapter/slack'
import { postSlackAgentMessage, slackReplyPayload } from './slack-reply'

test('agent markdown is sent as Slack-rendered markdown_text', async () => {
  const payload = await slackReplyPayload('**pong** — see [docs](https://example.com)\n\n- one\n- two')
  assert.ok('markdown_text' in payload)
  assert.match(payload.markdown_text, /\*\*pong\*\*/)
  assert.equal('text' in payload, false)
})

test('replies over the markdown_text cap fall back to mrkdwn text', async () => {
  const long = `**bold** ${'x'.repeat(13_000)}`
  const payload = await slackReplyPayload(long)
  assert.ok('text' in payload)
  // Standard **bold** becomes Slack mrkdwn *bold*.
  assert.match(payload.text, /^\*bold\* /)
  assert.doesNotMatch(payload.text, /\*\*bold\*\*/)
})

test('all Slack posts and edits retain the installed bot identity', async () => {
  const posts: Record<string, unknown>[] = []
  const edits: Record<string, unknown>[] = []
  const adapter = {
    getInstallation: async () => ({ botToken: 'fixture-bot-token' }),
    withBotToken: async (token: string, callback: () => Promise<unknown>) => {
      assert.equal(token, 'fixture-bot-token')
      return await callback()
    },
    webClient: { chat: {
      postMessage: async (payload: Record<string, unknown>) => {
        posts.push(payload)
        return { ok: true, ts: 'posted' }
      },
      update: async (payload: Record<string, unknown>) => {
        edits.push(payload)
        return { ok: true, ts: 'edited' }
      },
    } },
  } as unknown as SlackAdapter
  for (const text of ['_Working…_', 'Startup failed', 'Terminal result', 'Needs input', '']) {
    for (const editTs of [undefined, 'placeholder']) {
      const result = await postSlackAgentMessage({ adapter, teamId: 'team', channelId: 'channel',
        threadTs: 'thread', text, editTs })
      assert.equal(result.posted, true)
    }
  }
  assert.equal(posts.length, 5)
  assert.equal(edits.length, 5)
  for (const payload of [...posts, ...edits]) {
    for (const key of ['username', 'icon_url', 'icon_emoji']) assert.equal(key in payload, false)
    assert.equal(payload.channel, 'channel')
  }
  assert.ok(posts.every(payload => payload.thread_ts === 'thread'))
  assert.ok(edits.every(payload => payload.ts === 'placeholder'))
})
