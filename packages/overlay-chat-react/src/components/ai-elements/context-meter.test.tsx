import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextMeter, contextMeterLabel, latestContextUsage } from './context-meter'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('label rounds to percent and compact token counts', () => {
  assert.equal(contextMeterLabel(64_000, 200_000), '32% of context used (64k of 200k tokens)')
  assert.equal(contextMeterLabel(1_500_000, 1_000_000), '100% of context used (1.5M of 1M tokens)')
})

test('meter renders a labelled ring and hides without a context window', () => {
  const html = renderToStaticMarkup(<ContextMeter usedTokens={180_000} contextWindow={200_000} />)
  assert.match(html, /role="img"/)
  assert.match(html, /data-high="true"/)
  assert.equal(renderToStaticMarkup(<ContextMeter usedTokens={10} contextWindow={0} />), '')
})

test('latest usage comes from the newest assistant reply with usage', () => {
  const usage = latestContextUsage([
    { role: 'assistant', metadata: { usage: { totalTokens: 500 }, contextWindow: 1000 } },
    { role: 'user' },
    { role: 'assistant', metadata: { usage: { inputTokens: 700, outputTokens: 100 }, contextWindow: 1000 } },
  ])
  assert.deepEqual(usage, { usedTokens: 800, contextWindow: 1000 })
  assert.equal(latestContextUsage([{ role: 'assistant', metadata: {} }]), null)
})
