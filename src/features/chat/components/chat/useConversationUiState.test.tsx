import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import React, { act, useEffect } from 'react'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime } from '../chat-interface/types'
import { useConversationUiState, type UseConversationUiStateParams } from './useConversationUiState'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

function fixture(t: TestContext) {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const runtime = {
    hydrated: true,
    ui: createConversationUiState({ activeChatTitle: 'Original', exchangeModes: ['act'], isFirstMessage: false }),
  } as ConversationRuntime
  const setSelectedModels = t.mock.fn()
  const setSelectedActModel = t.mock.fn()
  const ensureConversationRuntime = t.mock.fn(() => runtime)
  const params: UseConversationUiStateParams = {
    activeChatId: 'chat-a',
    activeChatIdRef: { current: 'chat-a' },
    applyDefaultChatModelsToView: createConversationUiState,
    clearTransientComposerState() {},
    ensureConversationRuntime,
    lastGeneratedImageUrlRef: { current: null },
    pendingTitleRef: { current: null },
    replaceActiveChatRoute() {},
    resetComposerToolIds() {},
    runtimesRef: { current: new Map([['chat-a', runtime]]) },
    selectedActModel: runtime.ui.selectedActModel,
    selectedModels: runtime.ui.selectedModels,
    setActiveChatId() {},
    setActiveViewer() {},
    setInterruptedExchangeIdx() {},
    setIsTemporaryChat() {},
    setSelectedActModel,
    setSelectedModels,
    setSourcesPanel() {},
  }
  let controller!: ReturnType<typeof useConversationUiState>
  function Probe({ summary }: {
    summary?: { _id: string; title: string; lastModified?: number } | null
  }) {
    const current = useConversationUiState({ ...params, canonicalChatTitle: summary })
    useEffect(() => { controller = current }, [current])
    return null
  }
  return { Probe, params, runtime, setSelectedModels, setSelectedActModel, ensureConversationRuntime, current: () => controller }
}

test('canonical title projection preserves model selection without retriggering metadata saves', async (t) => {
  const f = fixture(t)
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<f.Probe />) })
  t.after(async () => { await act(async () => { renderer.unmount() }) })
  await act(async () => { f.current().applyUiStateToView(f.runtime.ui) })
  f.setSelectedModels.mock.resetCalls()
  f.setSelectedActModel.mock.resetCalls()
  const runtimeModels = f.runtime.ui.selectedModels
  const runtimeResults = f.runtime.ui.generationResults
  const viewModes = f.current().exchangeModes
  const viewResults = f.current().generationResults

  await act(async () => {
    renderer.update(<f.Probe summary={{ _id: 'chat-a', title: 'Remote rename', lastModified: 1 }} />)
  })
  assert.equal(f.current().activeChatTitle, 'Original')
  assert.equal(f.runtime.ui.activeChatTitle, 'Remote rename')
  assert.equal(f.current().buildActiveUiStateSnapshot().activeChatTitle, 'Remote rename')
  const renamedUi = f.runtime.ui
  for (const lastModified of [2, 3, 4]) {
    await act(async () => {
      renderer.update(<f.Probe summary={{ _id: 'chat-a', title: 'Remote rename', lastModified }} />)
    })
    assert.equal(f.runtime.ui, renamedUi)
    assert.equal(f.current().buildActiveUiStateSnapshot().activeChatTitle, 'Remote rename')
  }
  assert.equal(f.setSelectedModels.mock.callCount(), 0)
  assert.equal(f.setSelectedActModel.mock.callCount(), 0)
  assert.equal(f.runtime.ui.selectedModels, runtimeModels)
  assert.equal(f.runtime.ui.generationResults, runtimeResults)
  assert.equal(f.current().exchangeModes, viewModes)
  assert.equal(f.current().generationResults, viewResults)
})

test('canonical title projection ignores nonselected and stale active-ref summaries', async (t) => {
  const f = fixture(t)
  f.runtime.ui = { ...f.runtime.ui, activeChatTitle: 'Current' }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<f.Probe />) })
  t.after(async () => { await act(async () => { renderer.unmount() }) })
  await act(async () => { f.current().applyUiStateToView(f.runtime.ui) })
  f.ensureConversationRuntime.mock.resetCalls()
  f.setSelectedModels.mock.resetCalls()
  f.setSelectedActModel.mock.resetCalls()
  await act(async () => { renderer.update(<f.Probe summary={{ _id: 'chat-b', title: 'Other' }} />) })
  assert.equal(f.current().activeChatTitle, 'Current')
  assert.equal(f.current().buildActiveUiStateSnapshot().activeChatTitle, 'Current')
  f.params.activeChatIdRef.current = 'chat-b'
  await act(async () => { renderer.update(<f.Probe summary={{ _id: 'chat-a', title: 'Late' }} />) })
  assert.equal(f.current().activeChatTitle, 'Current')
  assert.equal(f.current().buildActiveUiStateSnapshot().activeChatTitle, 'Current')
  assert.equal(f.runtime.ui.activeChatTitle, 'Current')
  assert.equal(f.ensureConversationRuntime.mock.callCount(), 0)
  assert.equal(f.setSelectedModels.mock.callCount(), 0)
})
