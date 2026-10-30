import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useChatStopController } from './useChatStopController'

function renderStopAction({
  conversationId,
  cleanup,
}: {
  conversationId: string
  cleanup: string[]
}) {
  const message = { id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'hello' }] }
  const runtime = {
    askChats: [{ messages: [message], status: 'streaming', stop: () => cleanup.push('ask stop') }],
    actChat: {
      messages: [message],
      status: 'streaming',
      stop: () => cleanup.push('act stop'),
    },
    ui: {},
  }
  const activeChatIdRef = { current: null as string | null }
  const actions: { stop?: () => Promise<void> } = {}

  function StopAction() {
    const { stopActiveChat } = useChatStopController({
      activeAskChats: runtime.askChats,
      activeChatId: conversationId,
      activeChatIdRef,
      actChat: {
        messages: runtime.actChat.messages,
        setMessages: (messages: unknown[]) => cleanup.push(`act messages:${messages.length}`),
        stop: runtime.actChat.stop,
      },
      chat0: {
        messages: runtime.askChats[0]!.messages,
        setMessages: (messages: unknown[]) => cleanup.push(`chat messages:${messages.length}`),
        stop: runtime.askChats[0]!.stop,
      },
      forceLiveSyncRender: () => cleanup.push('render'),
      getActiveRuntime: () => runtime as never,
      isActiveLoading: true,
      onSend: () => undefined,
      primaryMessages: [message] as never,
      replaceConversationRuntime: () => runtime as never,
      runtimesRef: { current: new Map() },
      setInput: () => undefined,
      setInterruptedExchangeIdx: (index) => cleanup.push(`interrupted:${index}`),
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
