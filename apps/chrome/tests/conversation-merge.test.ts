import { describe, expect, it } from 'vitest'
import type { ConversationMessage, MessageTextPart, StoredConversation } from '@overlay/extension-contracts'

/** Mirrors `withUpdatedConversation` in background/runtime.ts */
function withUpdatedConversation(
  conversations: StoredConversation[],
  updatedConversation: StoredConversation,
): StoredConversation[] {
  const next = conversations.filter((c) => c.id !== updatedConversation.id)
  next.unshift(updatedConversation)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

function updateConversationMessage(
  conversation: StoredConversation,
  messageId: string,
  updater: (m: ConversationMessage) => ConversationMessage,
): StoredConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((m) => (m.id === messageId ? updater(m) : m)),
  }
}

/**
 * Regression: the first act / chat stream must merge chunks against the latest persisted
 * conversation. If a second user message lands while stream-1 is still writing,
 * merging against a stale snapshot drops the second turn from storage/UI.
 */
describe('conversation merge (second message race)', () => {
  it('merging on fresh storage keeps a later user+assistant turn when updating an earlier assistant', () => {
    const text = (id: string, t: string): MessageTextPart => ({ type: 'text', id, text: t })
    const user1: ConversationMessage = {
      id: 'u1',
      role: 'user',
      parts: [text('p1', 'first')],
      createdAt: 1,
      turnId: 't1',
    }
    const assistant1: ConversationMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [],
      createdAt: 2,
      turnId: 't1',
      variantIndex: 0,
    }
    const user2: ConversationMessage = {
      id: 'u2',
      role: 'user',
      parts: [text('p2', 'second')],
      createdAt: 10,
      turnId: 't2',
    }
    const assistant2: ConversationMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [],
      createdAt: 11,
      turnId: 't2',
      variantIndex: 0,
    }

    const stale: StoredConversation = {
      id: 'c1',
      title: 'Chat',
      preview: '',
      updatedAt: 3,
      messages: [user1, assistant1],
      version: 3,
    }
    const fresh: StoredConversation = {
      ...stale,
      updatedAt: 12,
      messages: [user1, assistant1, user2, assistant2],
    }

    const staleAfterChunk = updateConversationMessage(stale, 'a1', (m) => ({
      ...m,
      parts: [text('out', 'partial')],
    }))
    const buggy = withUpdatedConversation([fresh], staleAfterChunk)
    expect(buggy[0].messages.some((m) => m.id === 'u2')).toBe(false)

    const good = updateConversationMessage(fresh, 'a1', (m) => ({
      ...m,
      parts: [text('out', 'partial')],
    }))
    const merged = withUpdatedConversation([fresh], good)
    expect(merged[0].messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    const a1 = merged[0].messages.find((m) => m.id === 'a1')!
    expect((a1.parts[0] as MessageTextPart).text).toBe('partial')
  })
})
