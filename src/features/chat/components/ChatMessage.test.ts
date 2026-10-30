import assert from 'node:assert/strict'
import test from 'node:test'
import { areTextChatMessagePropsEqual } from './ChatMessage'

type Props = Parameters<typeof areTextChatMessagePropsEqual>[0]

function earlierTurnProps(): Props {
  const message = { id: 'turn-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hello' }] }
  return {
    kind: 'text',
    message,
    exchangeIndex: 0,
    latestExchangeIndex: 1,
    primaryMessages: [message],
    actChat: { messages: [message] } as Props['actChat'],
    chatInstances: [],
    exchangeModes: ['act', 'act'],
    exchangeModels: [['openrouter/free'], ['openrouter/free']],
    selectedModels: ['openrouter/free'],
    isActiveLoading: true,
    isOptimisticLoading: false,
    interruptedExchangeIdx: null,
    exitingTurnIds: [],
    sourcesPanel: null,
    getResponseForExchange: () => null,
    onJumpToReply: () => {},
    onDeleteTurn: () => {},
    onReplyToAssistantText: () => {},
    onBranch: () => {},
    onOpenDraft: () => {},
    onCreateAutomationDraft: () => {},
    onOpenSources: () => {},
    onRetry: () => {},
    onOpenFilePreview: () => {},
    onOpenAttachmentPreview: () => {},
    onContinue: () => {},
    onGeneratedUiChange: () => {},
    status: 'completed',
  }
}

test('refreshes earlier turn actions when a later generation settles or starts', () => {
  const streaming = earlierTurnProps()
  const completed = { ...streaming, isActiveLoading: false }
  assert.equal(areTextChatMessagePropsEqual(streaming, completed), false)
  assert.equal(areTextChatMessagePropsEqual(completed, streaming), false)
})

test('keeps unchanged earlier turns memoized', () => {
  const props = earlierTurnProps()
  assert.equal(areTextChatMessagePropsEqual(props, { ...props }), true)
})
