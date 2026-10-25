import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  normalizeChatModelSelection,
  readStoredAskModelIds,
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
