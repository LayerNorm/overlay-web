import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import {
  EXCHANGE_LOADING_LABELS,
  ExchangeLoadingState,
  exchangeLoadingPresentation,
} from './ExchangeLoadingState'

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

test('standalone loading renders the large mark and rotating thinking vocabulary', () => {
  const markup = renderToStaticMarkup(
    <ExchangeLoadingState
      presentation={{ active: true, inlineTextMarker: false, marker: 'standalone' }}
    />,
  )

  assert.match(markup, /overlay-stream-marker--standalone/)
  assert.match(markup, /overlay-loading-word-track/)
  for (const label of EXCHANGE_LOADING_LABELS) assert.ok(markup.includes(label))
  assert.match(markup, /aria-label="Thinking"/)
})

test('compact loading keeps the mark without adding the word reel', () => {
  const markup = renderToStaticMarkup(
    <ExchangeLoadingState
      presentation={{ active: true, inlineTextMarker: false, marker: 'compact' }}
    />,
  )

  assert.match(markup, /overlay-stream-marker--standalone/)
  assert.doesNotMatch(markup, /overlay-loading-word-track/)
})
