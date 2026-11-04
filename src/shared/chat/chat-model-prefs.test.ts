import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  chatReasoningStorageKey,
  isPersistentChatReasoningScope,
  normalizeChatModelSelection,
  readStoredReasoningByModel,
  readStoredAskModelIds,
  writeStoredReasoningByModel,
} from './chat-model-prefs'

test('normalizes legacy multi-model selections to one model', () => {
  const selection = normalizeChatModelSelection({
    askModelIds: [DEFAULT_MODEL_ID, 'openai/gpt-4.1'],
    actModelId: DEFAULT_MODEL_ID,
  })
  assert.deepEqual(selection.askModelIds, [DEFAULT_MODEL_ID])
})

test('reads legacy model arrays and ignores a legacy multiple value', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let storedValue = JSON.stringify([DEFAULT_MODEL_ID, 'openai/gpt-4.1'])
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => storedValue },
  })
  try {
    assert.deepEqual(readStoredAskModelIds(), [DEFAULT_MODEL_ID])
    storedValue = JSON.stringify('multiple')
    assert.deepEqual(readStoredAskModelIds(), [DEFAULT_MODEL_ID])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: unknown }).window
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('reasoning choices are thread-scoped, preserve BYOK ids, and clear Default overrides', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    values.set('overlay_reasoning_level', 'high')
    const first = chatReasoningStorageKey({ type: 'thread', id: 'thread-one' })
    const second = chatReasoningStorageKey({ type: 'thread', id: 'thread-two' })
    const namespacedModel = 'byok/connection-one/vendor/model-a'
    assert.deepEqual(readStoredReasoningByModel(first), {})
    writeStoredReasoningByModel(first, { [namespacedModel]: 'medium' })
    assert.deepEqual(readStoredReasoningByModel(first), { [namespacedModel]: 'medium' })
    assert.deepEqual(readStoredReasoningByModel(second), {})
    writeStoredReasoningByModel(first, { [namespacedModel]: 'provider-default' })
    assert.deepEqual(readStoredReasoningByModel(first), {})
    assert.equal(values.get('overlay_reasoning_level'), 'high')
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: unknown }).window
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('temporary reasoning choices are memory-only', () => {
  assert.equal(isPersistentChatReasoningScope({ type: 'temporary', id: 'temp' }), false)
  assert.equal(isPersistentChatReasoningScope({ type: 'thread', id: 'thread' }), true)
  assert.equal(isPersistentChatReasoningScope({ type: 'workspace', id: 'workspace' }), true)
})
