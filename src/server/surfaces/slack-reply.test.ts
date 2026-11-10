import assert from 'node:assert/strict'
import test from 'node:test'
import { slackReplyPayload } from './slack-reply'

test('json-render cards become a bold title and summary, never a spec or submitted values', async () => {
  const payload = await slackReplyPayload('Lead-in', [{ type: 'text', text: 'Lead-in' }, {
    type: 'data', dataType: 'overlay.generated_ui', id: 'view', data: {
      version: 1, kind: 'json_render', catalogVersion: 1, title: 'Weekly report', summary: '42 tasks completed',
      specJson: '{"root":"private-spec"}', stateJson: '{"field":"private-state"}',
    },
  }])
  assert.ok('markdown_text' in payload)
  assert.ok(payload.markdown_text.includes('**Weekly report**'))
  assert.ok(payload.markdown_text.includes('42 tasks completed'))
  assert.ok(!JSON.stringify(payload).includes('private-'))
})

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
