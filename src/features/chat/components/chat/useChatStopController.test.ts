import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { completeGeneratingAssistantMessages } from './useChatStopController'

test('completeGeneratingAssistantMessages completes only generating assistant messages immutably', () => {
  const user = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
  const generating = {
    id: 'assistant-1',
    role: 'assistant',
    status: 'generating',
    parts: [{ type: 'text', text: 'hello' }],
  } as unknown as UIMessage
  const completed = {
    id: 'assistant-2',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: 'done' }],
  } as unknown as UIMessage
  const messages = [user, generating, completed]

  const patch = completeGeneratingAssistantMessages(messages)
  assert.equal(patch.changed, true)
  assert.notEqual(patch.messages, messages)
  assert.equal((patch.messages[1] as unknown as { status?: string }).status, 'completed')
  assert.equal((generating as unknown as { status?: string }).status, 'generating')
  assert.equal(patch.messages[0], user)
  assert.equal(patch.messages[2], completed)
})

test('completeGeneratingAssistantMessages preserves array identity when no messages change', () => {
  const messages = [{
    id: 'assistant-1',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: 'done' }],
  }] as unknown as UIMessage[]

  const patch = completeGeneratingAssistantMessages(messages)
  assert.equal(patch.changed, false)
  assert.equal(patch.messages, messages)
})
