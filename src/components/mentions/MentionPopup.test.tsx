import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MentionPopup } from './MentionPopup'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('the mention menu calls the people and agent directory Members', () => {
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: 1280, innerHeight: 800 },
  })

  try {
    const html = renderToStaticMarkup(
      <MentionPopup
        categories={[]}
        loading={false}
        position={{ x: 24, y: 24 }}
        onSelect={() => undefined}
        onUploadFile={() => undefined}
        onClose={() => undefined}
        query=""
        availableTypes={['person']}
        selectedCategory={null}
        onSelectedCategoryChange={() => undefined}
      />,
    )
    assert.match(html, />Members</)
    assert.doesNotMatch(html, /People &amp; agents/)
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
