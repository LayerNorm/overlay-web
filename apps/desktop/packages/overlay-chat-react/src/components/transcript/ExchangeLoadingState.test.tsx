import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const chatSurfaceCss = readFileSync(
  new URL('../../styles/chat-surface.css', import.meta.url),
  'utf8',
)

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

test('standalone loading reuses the tool-row mark and rotating thinking vocabulary', () => {
  const markup = renderToStaticMarkup(
    <ExchangeLoadingState
      presentation={{ active: true, inlineTextMarker: false, marker: 'standalone' }}
    />,
  )

  assert.match(markup, /overlay-loading-tool-logo/)
  assert.match(markup, /width="8"/)
  assert.match(markup, /height="8"/)
  assert.match(markup, /overlay-loading-word-track/)
  assert.match(markup, /overlay-loading-word tool-line-shimmer/)
  for (const label of EXCHANGE_LOADING_LABELS) assert.ok(markup.includes(label))
  assert.ok(EXCHANGE_LOADING_LABELS.every((label) => !label.endsWith('…')))
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

test('loading word reel holds each label for 2000ms and is not disabled by reduced motion', () => {
  assert.match(chatSurfaceCss, /animation: overlayChatLoadingWordReel 12s linear infinite/)
  assert.match(chatSurfaceCss, /0%,\s*15%\s*\{\s*transform: translate3d\(0, 0, 0\)/)
  assert.doesNotMatch(
    chatSurfaceCss,
    /overlay-loading-word-track\s*\{\s*animation:\s*none/,
  )
})
