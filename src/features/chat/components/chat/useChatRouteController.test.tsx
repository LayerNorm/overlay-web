import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect } from 'react'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime } from '../chat-interface/types'
import { useChatRouteController } from './useChatRouteController'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

test('blank handoff replaces the URL without Next internal flags and preserves a hydrated empty runtime', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const replacements: Array<{ data: unknown; href: string }> = []
  const params = new URLSearchParams('view=personal&id=retired&scope=personal')
  const window = Object.assign(new EventTarget(), {
    location: { search: `?${params}` },
    history: {
      state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} },
      replaceState: (data: unknown, _title: string, href: string) => replacements.push({ data, href }),
    },
    localStorage: { getItem: () => 'personal', setItem: () => undefined },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })

  const noop = () => undefined
  const activeChatIdRef = { current: 'retired' as string | null }
  const emptyRuntime = {
    askChats: [{ messages: [] }], actChat: { messages: [] },
    hydrated: false, ui: createConversationUiState(),
  } as unknown as ConversationRuntime
  let activeId: string | null = 'retired'
  let controller!: ReturnType<typeof useChatRouteController>
  function Probe() {
    const routeController = useChatRouteController({
      activeChatId: 'retired', activeChatIdRef,
      applyDefaultChatModelsToView: createConversationUiState,
      applyUiStateToView: noop, chatPrefsHydrated: true,
      clearTransientComposerState: noop, emptyRuntimeRef: { current: emptyRuntime },
      mode: 'chat', pendingTitleRef: { current: null }, pendingFirstSendRef: { current: null },
      persistActiveRuntimeUiState: noop, resetComposerToolIds: noop, routerReplace: noop,
      searchParams: params as Parameters<typeof useChatRouteController>[0]['searchParams'],
      selectedAutomation: null,
      setActiveChatId: (value) => { activeId = typeof value === 'function' ? value(activeId) : value },
      setActiveChatTitle: noop, setActiveViewer: noop, setInterruptedExchangeIdx: noop,
      setIsTemporaryChat: noop, setPendingRunConversationId: noop,
      setRuntimeHydrationVersion: noop, setSourcesPanel: noop,
    })
    useEffect(() => { controller = routeController }, [routeController])
    return null
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<Probe />) })
  try {
    await act(() => controller.resetToBlankChatSurface({ temporary: false }))
    assert.equal(activeId, null)
    assert.equal(activeChatIdRef.current, null)
    assert.equal(emptyRuntime.hydrated, true)
    assert.equal(replacements.length, 1)
    assert.equal(replacements[0].data, null, 'Next ignores external URL updates carrying its internal __NA flag')
    const target = new URL(replacements[0].href, 'https://preview.invalid')
    assert.equal(target.pathname, '/app/chat')
    assert.equal(target.searchParams.get('id'), null)
    assert.equal(target.searchParams.get('view'), 'personal')
  } finally {
    await act(() => renderer.unmount())
  }
})

test('URL-driven hydration cannot replace a pending workspace navigation with the old chat route', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const replacements: string[] = []
  const loads: Array<{ chatId: string; replaceUrl: boolean | undefined }> = []
  const params = new URLSearchParams('view=personal&id=source-chat&scope=personal')
  const window = Object.assign(new EventTarget(), {
    location: { pathname: '/app/w/target-workspace/chat', search: '?scope=personal&view=personal' },
    history: { replaceState: (_data: unknown, _title: string, href: string) => replacements.push(href) },
    localStorage: { getItem: () => 'personal', setItem: () => undefined },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })

  const noop = () => undefined
  const activeChatIdRef = { current: null as string | null }
  const emptyRuntimeRef = {
    current: {
      askChats: [{ messages: [] }], actChat: { messages: [] },
      hydrated: false, ui: createConversationUiState(),
    } as unknown as ConversationRuntime,
  }
  function Probe({ hydrated }: { hydrated: boolean }) {
    const { loadChatRef, syncStandaloneChatUrl } = useChatRouteController({
      activeChatId: null, activeChatIdRef,
      applyDefaultChatModelsToView: createConversationUiState,
      applyUiStateToView: noop, chatPrefsHydrated: hydrated,
      clearTransientComposerState: noop, emptyRuntimeRef,
      mode: 'chat', pendingTitleRef: { current: null }, pendingFirstSendRef: { current: null },
      persistActiveRuntimeUiState: noop, resetComposerToolIds: noop, routerReplace: noop,
      searchParams: params as Parameters<typeof useChatRouteController>[0]['searchParams'],
      selectedAutomation: null,
      setActiveChatId: noop, setActiveChatTitle: noop, setActiveViewer: noop,
      setInterruptedExchangeIdx: noop, setIsTemporaryChat: noop,
      setPendingRunConversationId: noop, setRuntimeHydrationVersion: noop, setSourcesPanel: noop,
    })
    useEffect(() => {
      loadChatRef.current = async (chatId, options) => {
        loads.push({ chatId, replaceUrl: options?.replaceUrl })
        syncStandaloneChatUrl(chatId, options)
      }
    }, [loadChatRef, syncStandaloneChatUrl])
    return null
  }

  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<Probe hydrated={false} />) })
  try {
    await act(async () => { renderer.update(<Probe hydrated />) })
    assert.deepEqual(loads, [{ chatId: 'source-chat', replaceUrl: false }])
    assert.deepEqual(replacements, [], 'reading the existing route must not write it back over navigation')
  } finally {
    await act(() => renderer.unmount())
  }
})
