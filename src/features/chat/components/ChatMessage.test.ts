import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessage, areTextChatMessagePropsEqual } from './ChatMessage'

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

test('memoization observes changed actions, presentation, status and permissions', () => {
  const props = { ...earlierTurnProps(), canonicalTranscript: true }
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, onBranch: () => {} }), false)
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, onOpenSources: () => {} }), false)
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, readOnly: true }), false)
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, status: 'error' }), false)
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, presentation: { showActions: false } }), false)
  assert.equal(areTextChatMessagePropsEqual(props, { ...props, getResponseForExchange: () => null }), true)
})

test('current and historical failed turns preserve prose and render the structured failure during reconnect', () => {
  for (const latestExchangeIndex of [0, 1]) {
    const props = earlierTurnProps()
    const response = { id: 'assistant', role: 'assistant' as const, status: 'error' as const, parts: [
      { type: 'text' as const, text: 'My network connection failed.' },
      { type: 'data-native-agent-error' as const, data: {
        runId: 'run', code: 'harness_failed', message: 'No durable progress.', retryable: false, failedAt: 1,
      } },
    ] }
    const messages = [props.message, response]
    const markup = renderToStaticMarkup(createElement(ChatMessage, {
      ...props, latestExchangeIndex, primaryMessages: messages, status: 'error',
      actChat: { messages, status: 'streaming' } as Props['actChat'],
      getResponseForExchange: () => response,
    }))
    assert.ok(markup.includes('No durable progress.'))
    assert.ok(markup.includes('My network connection failed.'))
    assert.ok(!markup.includes('Check your network'))
    assert.ok(!markup.includes('No failure reason is available.'))
  }
})
