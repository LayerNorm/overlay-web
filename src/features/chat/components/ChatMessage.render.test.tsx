import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRequire } from 'node:module'
import type { AgentRunResource } from '@overlay/api-client'
import { getPerfDebugSnapshot, resetPerfDebugSnapshot } from '@overlay/chat-react/lib/perf-debug'
import type { HydratedRemoteMessage } from '../../../../convex/lib/remoteMessageText'
import { ChatMessage, type ChatMessageProps } from './ChatMessage'
import type { ChatMessageListActions } from './ChatMessageList'
import { RunPlanContext } from './chat/run-plan-context'
import { useChatRowCallbacks } from './chat/useChatRowCallbacks'
import { buildNativeTranscriptView, useNativePersonalTranscript } from './chat/useNativePersonalTranscript'
import type { PersonalPendingTurn, PersonalTranscriptRow } from './chat/personal-transcript'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
  }
}
const noop = () => {}
const journal = new Map<string, PersonalPendingTurn>()
const sdkMessages: never[] = []
const actChat = { messages: sdkMessages } as Extract<ChatMessageProps, { kind: 'text' }>['actChat']

function message(id: string, turnId: string, role: 'user' | 'assistant', status?: 'completed' | 'generating') {
  return { _id: id, _creationTime: 1, conversationId: 'chat', userId: 'owner', turnId,
    role, mode: 'act', content: id, contentType: 'text', createdAt: 1, status,
  } as HydratedRemoteMessage
}

test('stream and live-plan updates skip completed rows while real changes remain visible', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>)
  const window = Object.assign(new EventTarget(), {
    location: { search: '?perf=1' },
    localStorage: { getItem: () => null },
    setTimeout, clearTimeout, setInterval, clearInterval,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop,
      addListener: noop, removeListener: noop }),
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let renderer: ReturnType<typeof create> | undefined
  t.after(async () => {
    if (renderer) await act(() => renderer!.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const earlier = message('answer-1', 'turn-1', 'assistant', 'completed')
  const live = message('answer-2', 'turn-2', 'assistant', 'generating')
  const rows = [message('user-1', 'turn-1', 'user'), earlier,
    message('user-2', 'turn-2', 'user'), live].map(message => ({ message, contextUser: null }))
  function Harness({ rows, revision, allowed = true, readOnly = false, scopeKey = 'owner/workspace/chat' }: {
    rows: PersonalTranscriptRow[]; revision: number; allowed?: boolean; readOnly?: boolean; scopeKey?: string
  }) {
    const { projection } = useNativePersonalTranscript({
      enabled: true, conversationId: 'chat', scopeKey,
      summaryConversationId: allowed ? 'chat' : null, transcriptConversationId: 'chat',
      status: 'ready', rows, journal, sdkMessages, runtimeHydrationVersion: revision, onJournalChange: noop,
    })
    const actions = useChatRowCallbacks({
      onJumpToReply: noop, onDeleteTurn: () => {}, onReplyToMediaPrompt: noop,
      onReplyToAssistantText: noop, onBranch: () => {}, onOpenDraft: noop,
      onCreateAutomationDraft: noop, onOpenSources: noop, onRetry: noop,
      onOpenFilePreview: noop, onOpenAttachmentPreview: noop, onContinue: () => {}, onGeneratedUiChange: noop,
    } satisfies ChatMessageListActions)
    const view = buildNativeTranscriptView(projection, [])
    const run = { turnId: 'turn-2', status: 'running', plan: [], updatedAt: revision } as unknown as AgentRunResource
    return <RunPlanContext.Provider value={run}>{view.exchanges.map((exchange, index) => (
      <ChatMessage key={exchange.turnId} {...actions}
        kind="text" message={exchange.user} readOnly={readOnly} canonicalTranscript
        canonicalResponse={exchange.responses.at(-1)} hasCanonicalResponse
        responseIdentity={exchange.responses.at(-1)?.id}
        exchangeIndex={index} latestExchangeIndex={view.exchanges.length - 1}
        primaryMessages={view.primaryMessages} actChat={actChat} chatInstances={[]}
        exchangeModes={view.exchangeModes} exchangeModels={view.exchangeModels} selectedModels={[]}
        isActiveLoading isOptimisticLoading={false} interruptedExchangeIdx={null}
        exitingTurnIds={[]} sourcesPanel={null} getResponseForExchange={() => null}
        status={index === view.exchanges.length - 1 ? 'streaming' : 'completed'}
      />
    ))}</RunPlanContext.Provider>
  }
  await act(async () => { renderer = create(<Harness rows={rows} revision={0} />) })
  resetPerfDebugSnapshot()
  const changed = rows.map(row => row.message === live
    ? { ...row, message: { ...live, content: 'New streamed content', nativeProgressSequence: 2 } } : row)
  await act(async () => renderer!.update(<Harness rows={changed} revision={1} />))
  let renders = getPerfDebugSnapshot().renders
  assert.equal(renders.ChatExchange ?? 0, 0)
  assert.ok(renders['ChatExchange(streaming)'] > 0)
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('New streamed content'))
  resetPerfDebugSnapshot()
  const edited = changed.map(row => row.message === earlier
    ? { ...row, message: { ...earlier, content: 'Edited completed response' } } : row)
  await act(async () => renderer!.update(<Harness rows={edited} revision={2} />))
  renders = getPerfDebugSnapshot().renders
  assert.ok(renders.ChatExchange > 0)
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('Edited completed response'))
  resetPerfDebugSnapshot()
  await act(async () => renderer!.update(<Harness rows={edited} revision={3} readOnly />))
  assert.ok(getPerfDebugSnapshot().renders.ChatExchange > 0)
  resetPerfDebugSnapshot()
  await act(async () => renderer!.update(<Harness rows={edited} revision={4} scopeKey="new-owner/workspace/chat" readOnly />))
  assert.ok(getPerfDebugSnapshot().renders.ChatExchange > 0)
  await act(async () => renderer!.update(<Harness rows={edited} revision={5} allowed={false} scopeKey="new-owner/workspace/chat" readOnly />))
  assert.equal(renderer!.toJSON(), null)
})
