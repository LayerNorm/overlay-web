import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VectorComponent } from './expressive-json-render'

const props: React.ComponentProps<typeof VectorComponent>['props'] = {
  title: 'Welcome home',
  description: 'A welcome illustration.',
  width: 520,
  height: 240,
  shapes: [
    { id: 'caption', kind: 'text', x: 24, y: 48, text: 'Welcome home', tone: 'accent' },
    { id: 'accent-block', kind: 'rect', x: 24, y: 72, width: 40, height: 24, fill: 'accent' },
  ],
}

test('Vector accent text uses the theme foreground while accent shapes keep their paint', () => {
  for (const theme of ['light', 'dark']) {
    const html = renderToStaticMarkup(<div data-theme={theme}><VectorComponent props={props} /></div>)
    assert.match(html, /<text\b[^>]*fill="var\(--foreground\)"[^>]*>Welcome home<\/text>/)
    assert.match(html, /<rect\b[^>]*fill="var\(--primary\)"/)
  }
})
