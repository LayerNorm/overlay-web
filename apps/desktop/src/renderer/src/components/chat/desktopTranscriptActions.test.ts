import { describe, expect, it } from 'vitest'
import { groupTranscriptMessages } from '@overlay/chat-core'
import {
  cloneMessagesThroughTurn,
  messageIdsForTurnDeletion,
  resolveDesktopExchangeActionTargets
} from './desktopTranscriptActions'
import type { Message } from './types'

const messages: Message[] = [
  { id: 'user-1', turnId: 'turn-1', role: 'user', content: 'Compare', timestamp: 1 },
  {
    id: 'assistant-1',
    turnId: 'turn-1',
    role: 'assistant',
    content: '',
    timestamp: 2,
    selectedModelId: 'alpha',
    responses: [
      {
        modelId: 'alpha',
        modelName: 'Alpha',
        provider: 'test',
        content: 'Alpha answer',
        isLoading: false
      },
      {
        modelId: 'beta',
        modelName: 'Beta',
        provider: 'test',
        content: 'Beta answer',
        isLoading: false
      }
    ]
  },
  {
    id: 'assistant-legacy-variant',
    turnId: 'turn-1',
    role: 'assistant',
    content: 'Gamma answer',
    timestamp: 3,
    selectedModelId: 'gamma'
  }
]

describe('desktop transcript actions', () => {
  it('routes selection through the exchange assistant and replies to the selected response owner', () => {
    const group = groupTranscriptMessages(messages)[0]
    const targets = resolveDesktopExchangeActionTargets(group, 'beta')

    expect(targets.userMessage?.id).toBe('user-1')
    expect(targets.selectionMessage?.id).toBe('assistant-1')
    expect(targets.actionMessage?.id).toBe('assistant-1')
  })

  it('deletes every message with the same explicit turn id', () => {
    expect([...messageIdsForTurnDeletion(messages, 'user-1')]).toEqual([
      'user-1',
      'assistant-1',
      'assistant-legacy-variant'
    ])
  })

  it('deletes all adjacent assistants in a legacy turn', () => {
    const legacy = messages.map((message) => ({ ...message, turnId: undefined }))
    expect([...messageIdsForTurnDeletion(legacy, 'user-1')]).toEqual([
      'user-1',
      'assistant-1',
      'assistant-legacy-variant'
    ])
  })

  it('clones every message through the selected exchange for branching', () => {
    const laterMessage: Message = {
      id: 'user-2',
      turnId: 'turn-2',
      role: 'user',
      content: 'Continue',
      timestamp: 4
    }
    const source = [...messages, laterMessage]
    const branch = cloneMessagesThroughTurn(source, 'turn-1')

    expect(branch?.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'assistant-legacy-variant'
    ])
    expect(branch?.[0]).not.toBe(source[0])
    expect(branch?.[1]?.responses).not.toBe(source[1]?.responses)
  })

  it('uses legacy exchange adjacency and rejects an unknown branch target', () => {
    const legacy = messages.map((message) => ({ ...message, turnId: undefined }))
    const legacyTurnId = groupTranscriptMessages(legacy)[0]?.turnId

    expect(cloneMessagesThroughTurn(legacy, legacyTurnId ?? '')?.map((message) => message.id)).toEqual(
      ['user-1', 'assistant-1', 'assistant-legacy-variant']
    )
    expect(cloneMessagesThroughTurn(messages, 'missing-turn')).toBeNull()
  })
})
