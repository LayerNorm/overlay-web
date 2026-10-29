import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

it('uses the canonical Overlay wordmark with static eyes by default', () => {
  const html = renderToStaticMarkup(React.createElement(BrandMark))
  expect(html).toContain('aria-label="Overlay"')
  expect(html).toContain('brand-lockup-word">verlay</span>')
  expect(html).toContain('overlay-mark--none')
  expect(html).not.toContain('overlay-stream-marker')
})

it('maps the existing pulse input to looking eyes', () => {
  const html = renderToStaticMarkup(React.createElement(BrandMark, { pulse: true }))
  expect(html).toContain('overlay-mark--look')
  expect(html).not.toContain('overlay-mark--none')
})
