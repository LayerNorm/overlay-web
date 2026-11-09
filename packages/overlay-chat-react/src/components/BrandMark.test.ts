import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { BrandMark } from './BrandMark'

it('uses the canonical Overlay wordmark with static eyes by default', () => {
  const html = renderToStaticMarkup(React.createElement(BrandMark))
  assert.ok(html.includes('aria-label="Overlay"'))
  assert.ok(html.includes('approved-brand'))
  assert.ok(html.includes('approved-brand--none'))
  assert.ok(!html.includes('overlay-stream-marker'))
})

it('maps the existing pulse input to looking eyes', () => {
  const html = renderToStaticMarkup(React.createElement(BrandMark, { pulse: true }))
  assert.ok(html.includes('approved-brand--look'))
  assert.ok(!html.includes('approved-brand--none'))
})
