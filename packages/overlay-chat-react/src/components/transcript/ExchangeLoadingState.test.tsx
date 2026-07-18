import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { exchangeLoadingPresentation } from './ExchangeLoadingState'

const text = [{ kind: 'text', text: 'Partial' }] satisfies AssistantVisualBlock[]
const file = [{ kind: 'file', url: 'data:image/png;base64,AA==', mediaType: 'image/png' }] satisfies AssistantVisualBlock[]
const tool = [{
  kind: 'tool',
  key: 'tool-1',
  name: 'search',
  state: 'input-available',
}] satisfies AssistantVisualBlock[]

test('loading presentation follows normalized exchange status and visible output', () => {
  assert.deepEqual(exchangeLoadingPresentation('submitted', []), {
    active: true,
    inlineTextMarker: false,
    marker: 'standalone',
  })
  assert.deepEqual(exchangeLoadingPresentation('streaming', text), {
    active: true,
    inlineTextMarker: true,
    marker: 'none',
  })
  assert.equal(exchangeLoadingPresentation('streaming', file).marker, 'compact')
  assert.equal(exchangeLoadingPresentation('executing-tool', tool).marker, 'none')
  assert.equal(exchangeLoadingPresentation('completed', text).active, false)
  assert.equal(exchangeLoadingPresentation('interrupted', text).active, false)
  assert.equal(exchangeLoadingPresentation('error', text).active, false)
})
