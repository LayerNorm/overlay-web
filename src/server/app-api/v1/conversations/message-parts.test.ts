import assert from 'node:assert/strict'
import test from 'node:test'
import {conversationMessageParts} from './message-parts'

test('an empty cancelled message retains its canonical status through the API text fallback', () => {
  const status = {type: 'data-remote-agent-status', data: {runId: 'run', state: 'cancelled'}}
  assert.deepEqual(conversationMessageParts({content: '', parts: [status]}), [{type: 'text', text: ''}, status])
})

test('legacy fallback preserves the partial answer together with status, approval and saved-file metadata', () => {
  const metadata = [
    {type: 'data-remote-agent-status', data: {runId: 'run', state: 'needs_attention'}},
    {type: 'data-remote-agent-request', data: {requestKey: 'request', state: 'pending'}},
    {type: 'data-remote-agent-drive', data: {state: 'saved', fileCount: 1}},
  ]
  assert.deepEqual(conversationMessageParts({content: '**Partial answer**', parts: [{type: 'text', text: ''}, ...metadata]}),
    [{type: 'text', text: '**Partial answer**'}, ...metadata])
})

test('already structured answers, tools and attachments retain their established representation', () => {
  for (const parts of [
    [{type: 'text', text: 'Structured answer'}],
    [{type: 'tool-invocation', toolInvocation: {toolCallId: 'tool'}}],
    [{type: 'file', url: '/attachment'}],
  ]) assert.deepEqual(conversationMessageParts({content: 'Legacy content', parts}), parts)
})
