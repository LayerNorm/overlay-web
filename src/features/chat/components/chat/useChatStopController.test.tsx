import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useEffect } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { nativeStopIntentMatches, useChatStopController } from './useChatStopController'

function renderStopAction({
  conversationId,
  cleanup,
  activateWhileStopping = false,
  nativeScope,
}: {
  conversationId: string
  cleanup: string[]
  activateWhileStopping?: boolean
  nativeScope?: Parameters<typeof useChatStopController>[0]['nativeScope']
}) {
  const message = { id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'hello' }] }
  const messages = nativeScope ? [] : [message]
  const runtime = {
    askChats: [{ messages, status: 'streaming', stop: () => cleanup.push('ask stop') }],
    actChat: {
      messages,
      status: 'streaming',
      stop: () => {
        cleanup.push('act stop')
        if (activateWhileStopping) {
          queueMicrotask(() => {
            runtime.askChats[0]!.messages = []
            runtime.actChat.messages = []
            activeChatIdRef.current = conversationId
            cleanup.push('first turn activated')
          })
        }
      },
    },
    ui: {},
  }
  const activeChatIdRef = { current: null as string | null }
  const actions: { stop?: () => Promise<void> } = {}

  function StopAction() {
    const { stopActiveChat } = useChatStopController({
      activeAskChats: nativeScope ? [] : runtime.askChats,
      activeChatId: conversationId,
      activeChatIdRef,
      actChat: {
        messages,
        setMessages: (messages: unknown[]) => cleanup.push(`act messages:${messages.length}`),
        stop: runtime.actChat.stop,
      },
      chat0: {
        messages,
        setMessages: (messages: unknown[]) => cleanup.push(`chat messages:${messages.length}`),
        stop: runtime.askChats[0]!.stop,
      },
      forceLiveSyncRender: () => cleanup.push('render'),
      getActiveRuntime: () => runtime as never,
      isActiveLoading: true,
      onSend: () => undefined,
      primaryMessages: messages as never,
      replaceConversationRuntime: () => runtime as never,
      runtimesRef: { current: new Map() },
      setInput: () => undefined,
      setInterruptedExchangeIdx: (index) => cleanup.push(`interrupted:${index}`),
      nativeScope,
    })
    // eslint-disable-next-line react-hooks/immutability -- SSR captures the handler for invocation after render.
    actions.stop = stopActiveChat
    return null
  }

  renderToStaticMarkup(createElement(StopAction))
  return actions.stop?.()
}

test('stopping a pending first turn uses its real conversation id when the active ref is empty', async (t) => {
  const conversationIds: Array<string | undefined> = []
  const cleanup: string[] = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async ({ conversationId }) => {
    conversationIds.push(conversationId)
    return new Response(null, { status: 200 })
  })
  const stopPromise = renderStopAction({
    conversationId: 'conversation-pending',
    cleanup,
  })

  assert.ok(stopPromise)
  await stopPromise

  assert.deepEqual(conversationIds, ['conversation-pending'])
  assert.deepEqual(cleanup, [
    'ask stop',
    'act stop',
    'chat messages:1',
    'act messages:1',
    'interrupted:0',
    'render',
  ])
})

test('first-turn activation during backend cancellation cannot replace the visible transcript with the reset preview', async (t) => {
  const cleanup: string[] = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async () => {
    await Promise.resolve()
    cleanup.push('backend cancelled')
    return new Response(null, { status: 200 })
  })

  await renderStopAction({
    conversationId: 'conversation-pending',
    cleanup,
    activateWhileStopping: true,
  })

  assert.deepEqual(cleanup, [
    'ask stop',
    'act stop',
    'chat messages:1',
    'act messages:1',
    'interrupted:0',
    'render',
    'first turn activated',
    'backend cancelled',
  ])
})

test('a failed backend stop reports that cancellation was not confirmed and still cleans up locally', async (t) => {
  const toastErrors: string[] = []
  const cleanup: string[] = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async () => (
    new Response(null, { status: 503 })
  ))
  t.mock.method(toast, 'error', (message) => {
    toastErrors.push(String(message))
  })
  const stopPromise = renderStopAction({
    conversationId: 'conversation-pending',
    cleanup,
  })

  assert.ok(stopPromise)
  await stopPromise

  assert.deepEqual(toastErrors, [
    'Could not confirm that the response stopped. It may still be running.',
  ])
  assert.ok(cleanup.includes('interrupted:0'))
})

test('native observer stop targets only the durable assistant message without restoring SDK history', async (t) => {
  const requests: Array<{ conversationId: string; messageId?: string }> = []
  const cleanup: string[] = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async (args) => {
    requests.push(args)
    return new Response(null, { status: 200 })
  })
  const nativeScope = {
    enabled: true,
    writable: true,
    status: 'ready',
    scopeKey: 'viewer:workspace:conversation-native',
    userId: 'owner',
    workspaceId: 'workspace',
    conversationId: 'conversation-native',
    currentTurnId: 'turn-current',
    run: {
      id: 'run',
      conversationId: 'conversation-native',
      turnId: 'turn-current',
      userId: 'owner',
      assistantMessageId: 'assistant-checkpoint',
      status: 'running',
    },
    isCurrentScope: () => true,
  } as Parameters<typeof nativeStopIntentMatches>[1]

  await renderStopAction({
    conversationId: 'conversation-native',
    cleanup,
    nativeScope,
  })

  assert.deepEqual(requests, [{
    conversationId: 'conversation-native',
    messageId: 'assistant-checkpoint',
  }])
  assert.deepEqual(cleanup, ['act stop', 'render'])
})

test('early native stop intent applies only to the current exact turn and durable conversation', () => {
  const scope = {
    enabled: true,
    writable: true,
    status: 'ready',
    scopeKey: 'viewer:workspace:conversation',
    userId: 'viewer',
    workspaceId: 'workspace',
    conversationId: 'conversation',
    currentTurnId: 'turn',
    run: null,
    isCurrentScope: () => true,
  } as Parameters<typeof nativeStopIntentMatches>[1]
  const intent = {
    scopeKey: 'viewer:workspace:conversation', userId: 'viewer',
    conversationId: 'conversation', turnId: 'turn',
  }
  const run = {
    id: 'run',
    conversationId: 'conversation',
    turnId: 'turn',
    userId: 'viewer',
    assistantMessageId: 'assistant',
    status: 'running',
  } as never
  assert.equal(nativeStopIntentMatches(intent, scope, run), true)
  assert.equal(nativeStopIntentMatches({
    ...intent, conversationId: null,
  }, scope, run), true)
  assert.equal(nativeStopIntentMatches(intent, { ...scope, currentTurnId: 'newer-turn' }, run), false)
  assert.equal(nativeStopIntentMatches(intent, scope, { ...run, conversationId: 'other' }), false)
  assert.equal(nativeStopIntentMatches({ ...intent, scopeKey: 'stale-scope' }, scope, run), false)
  assert.equal(nativeStopIntentMatches(intent, { ...scope, isCurrentScope: () => false }, run), false)
  assert.equal(nativeStopIntentMatches(intent, { ...scope, writable: false }, run), false)
})

test('native stop checks current scope before local SDK stop', async (t) => {
  const cleanup: string[] = []
  const requests: unknown[] = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async (args) => {
    requests.push(args)
    return new Response(null, { status: 200 })
  })
  await renderStopAction({
    conversationId: 'conversation-native',
    cleanup,
    nativeScope: {
      enabled: true,
      writable: true,
      status: 'ready',
      scopeKey: 'scope',
      userId: 'owner',
      workspaceId: 'workspace',
      conversationId: 'conversation-native',
      currentTurnId: 'turn',
      run: null,
      isCurrentScope: () => false,
    },
  })
  assert.deepEqual(cleanup, [])
  assert.deepEqual(requests, [])
})

test('native stop deduplicates successful responses while the durable run snapshot is stale', async (t) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const requests: Array<{ conversationId: string; messageId?: string }> = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async (args) => {
    requests.push(args)
    return new Response(null, { status: 200 })
  })
  const messages: never[] = []
  const runtime = {
    askChats: [{ messages, status: 'streaming', stop() {} }],
    actChat: { messages, status: 'streaming', stop() {} },
    ui: {},
  }
  let stop: (() => Promise<void>) | undefined
  function StopAction() {
    const stopAction = useChatStopController({
      activeAskChats: [],
      activeChatId: 'conversation-native',
      activeChatIdRef: { current: 'conversation-native' },
      actChat: { messages, setMessages() {}, stop() {} },
      chat0: { messages, setMessages() {}, stop() {} },
      forceLiveSyncRender() {},
      getActiveRuntime: () => runtime as never,
      isActiveLoading: true,
      onSend() {},
      primaryMessages: [],
      replaceConversationRuntime: () => runtime as never,
      runtimesRef: { current: new Map() },
      setInput() {},
      setInterruptedExchangeIdx() {},
      nativeScope: {
        enabled: true,
        writable: true,
        status: 'ready',
        scopeKey: 'scope',
        userId: 'owner',
        workspaceId: 'workspace',
        conversationId: 'conversation-native',
        currentTurnId: 'turn',
        run: {
          id: 'run',
          conversationId: 'conversation-native',
          turnId: 'turn',
          userId: 'owner',
          assistantMessageId: 'assistant',
          status: 'running',
        },
        isCurrentScope: () => true,
      },
    }).stopActiveChat
    useEffect(() => { stop = stopAction }, [stopAction])
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(StopAction)) })
  await act(async () => { await stop?.() })
  await act(async () => { await stop?.() })
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], {
    conversationId: 'conversation-native',
    messageId: 'assistant',
  })
  await act(async () => { renderer!.unmount() })
})

test('early native stop waits for a ready writable snapshot of the exact run', async (t) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const requests: Array<{ conversationId: string; messageId?: string }> = []
  t.mock.method(overlayAppClient.conversations, 'stopResponse', async (args) => {
    requests.push(args)
    return new Response(null, { status: 200 })
  })
  const messages: never[] = []
  const runtime = {
    askChats: [{ messages, status: 'streaming', stop() {} }],
    actChat: { messages, status: 'streaming', stop() {} },
    ui: {},
  }
  let nativeScope: NonNullable<Parameters<typeof useChatStopController>[0]['nativeScope']> = {
    enabled: true,
    writable: false,
    status: 'loading',
    scopeKey: 'scope',
    userId: 'owner',
    workspaceId: 'workspace',
    conversationId: 'conversation-native',
    currentTurnId: 'turn',
    run: null,
    isCurrentScope: () => true,
  }
  let stop: (() => Promise<void>) | undefined
  function StopAction() {
    const stopAction = useChatStopController({
      activeAskChats: [],
      activeChatId: 'conversation-native',
      activeChatIdRef: { current: 'conversation-native' },
      actChat: { messages, setMessages() {}, stop() {} },
      chat0: { messages, setMessages() {}, stop() {} },
      forceLiveSyncRender() {},
      getActiveRuntime: () => runtime as never,
      isActiveLoading: true,
      onSend() {},
      primaryMessages: [],
      replaceConversationRuntime: () => runtime as never,
      runtimesRef: { current: new Map() },
      setInput() {},
      setInterruptedExchangeIdx() {},
      nativeScope,
    }).stopActiveChat
    useEffect(() => { stop = stopAction }, [stopAction])
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(StopAction)) })
  await act(async () => { await stop?.() })
  assert.deepEqual(requests, [])

  nativeScope = {
    ...nativeScope,
    writable: true,
    status: 'ready',
    run: {
      id: 'run',
      conversationId: 'conversation-native',
      turnId: 'turn',
      userId: 'owner',
      assistantMessageId: 'assistant',
      status: 'running',
    },
  }
  await act(async () => { renderer!.update(createElement(StopAction)) })
  await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)) })
  assert.deepEqual(requests, [{
    conversationId: 'conversation-native',
    messageId: 'assistant',
  }])
  await act(async () => { renderer!.unmount() })
})
