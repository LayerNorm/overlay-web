import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationUiState } from '../chat-interface/types'
import {
  buildImageGenerationRequestBody,
  scheduleMediaGenerationUpgradeFailure,
} from './chatMediaGeneration'

test('image generation request omits empty optional imageUrl', () => {
  assert.deepEqual(
    buildImageGenerationRequestBody({
      promptForModel: 'draw',
      modelId: 'image-model',
      chatId: 'chat-1',
      turnId: 'turn-1',
      imageUrl: null,
    }),
    {
      prompt: 'draw',
      modelId: 'image-model',
      conversationId: 'chat-1',
      turnId: 'turn-1',
    },
  )

  assert.equal(
    buildImageGenerationRequestBody({
      promptForModel: 'draw',
      modelId: 'image-model',
      temporaryChat: true,
      chatId: 'chat-1',
      turnId: 'turn-1',
      imageUrl: 'data:image/png;base64,a',
    }).imageUrl,
    'data:image/png;base64,a',
  )
})

test('free-tier media upgrade failure marks every slot failed and completes session', async () => {
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
    },
  })

  try {
    let ui = createConversationUiState() as ConversationUiState
    let completed: [string, boolean] | null = null
    scheduleMediaGenerationUpgradeFailure({
      chatId: 'chat-1',
      exchIdx: 0,
      kind: 'image',
      activeModels: ['image-a', 'image-b'],
      isChatActive: () => true,
      updateRuntimeUiState: (_chatId: string, updater: (prev: ConversationUiState) => ConversationUiState) => {
        ui = updater(ui)
      },
      completeSession: (chatId, active) => {
        completed = [chatId, active]
      },
      delayMs: 0,
    })

    await new Promise((resolve) => setTimeout(resolve, 5))
    const results = ui.generationResults.get(0)
    assert.equal(results?.length, 2)
    assert.equal(results?.[0]?.status, 'failed')
    assert.equal(results?.[0]?.upgradeRequired, true)
    assert.equal(results?.[1]?.status, 'failed')
    assert.deepEqual(completed, ['chat-1', true])
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  }
})
