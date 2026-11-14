import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { chatMessagesForExport } from './chat-export'

const user: UIMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Compare our plans.' }] }
const assistant: UIMessage = { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Here is the comparison.' }] }

test('export includes native assistant responses held outside primaryMessages', () => {
  const messages = chatMessagesForExport([user], () => assistant, () => [assistant])
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant'])
  assert.deepEqual(messages.map(message => message.content), ['Compare our plans.', 'Here is the comparison.'])
})

test('export supports SDK responses and empty or unanswered chats', () => {
  assert.deepEqual(chatMessagesForExport([], () => null), [])
  assert.deepEqual(chatMessagesForExport([user], () => null).map(message => message.role), ['user'])
  assert.deepEqual(chatMessagesForExport([user, assistant], () => assistant).map(message => message.role), ['user', 'assistant'])
})
