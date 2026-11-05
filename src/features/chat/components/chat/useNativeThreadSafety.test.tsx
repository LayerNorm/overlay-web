import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import { useNativePersonalSafetyScope } from './useNativePersonalControllerState'
import { useNativeThreadSafety } from './useNativeThreadSafety'

test('pending-first native scope survives its own id hydration and expires on route or identity change', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let activeChatId: string | null = PENDING_FIRST_CHAT_ID
  let pendingRunConversationId: string | null = null
  let userId = 'viewer'
  let selectedConversationId: string | null = null
  let current: (() => boolean) | undefined
  function Harness() {
    const nativeSafety = useNativePersonalSafetyScope({
      activeChatId,
      chatWorkspaceId: 'workspace',
      isTemporaryChat: false,
      nativePersonalRoute: true,
      pendingRunConversationId,
      nativePersonal: {
        selectedConversationId,
        viewerUserId: userId,
        execution: { status: 'loading', value: null },
      } as never,
    }).nativeThreadSafety
    const isCurrentScope = nativeSafety.isCurrentScope
    useEffect(() => { current = isCurrentScope }, [isCurrentScope])
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(Harness)) })
  const initialScope = current!
  pendingRunConversationId = 'created-conversation'
  await act(async () => { renderer!.update(createElement(Harness)) })
  assert.equal(initialScope(), true)

  activeChatId = 'another-conversation'
  selectedConversationId = 'another-conversation'
  await act(async () => { renderer!.update(createElement(Harness)) })
  assert.equal(initialScope(), false)
  const routeScope = current!
  userId = 'different-viewer'
  await act(async () => { renderer!.update(createElement(Harness)) })
  assert.equal(routeScope(), false)
  await act(async () => { renderer!.unmount() })
})

test('native safety uses the scoped compatibility snapshot without legacy HTTP refreshes', async (t) => {
  const get = t.mock.method(overlayAppClient.conversations, 'get', async () => {
    throw new Error('Native safety must not read the legacy endpoint.')
  })
  const input = {
    conversationId: 'conversation',
    workspaceId: 'workspace',
    nativeMode: true,
    verifiedUserId: 'viewer',
    nativeExecution: {
      status: 'ready',
      value: {
        conversationId: 'conversation',
        workspaceId: 'workspace',
        userId: 'viewer',
        compatibility: { readOnly: false },
      },
    } as never,
  }
  let value!: ReturnType<typeof useNativeThreadSafety>
  function Probe() {
    const safety = useNativeThreadSafety(input)
    useEffect(() => { value = safety }, [safety])
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(createElement(Probe)) })
  assert.equal(value!.status, 'writable')
  await act(async () => { assert.equal(await value!.ensureWritable(), true) })
  await act(async () => { assert.equal(await value!.refresh(), 'writable') })
  assert.equal(get.mock.callCount(), 0)
  await act(async () => { renderer!.unmount() })
})
