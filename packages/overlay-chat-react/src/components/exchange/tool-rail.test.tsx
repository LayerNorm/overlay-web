import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolLineLogo } from './tool-rail'

test('every trace step uses the SVG O mark in the trace icon slot, not a raster logo', () => {
  const markup = renderToStaticMarkup(<ToolLineLogo />)

  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /data-slot="trace-icon"/)
  assert.match(markup, /<svg/)
  assert.match(markup, /data-slot="trace-icon"[^>]*size-\[1em\]/)
  assert.match(markup, /<svg[^>]*size-\[1em\]!/)
  assert.doesNotMatch(markup, /0\.5em/)
  assert.match(markup, /width="13"/)
  assert.match(markup, /aria-hidden="true"/)
})

test('only running trace steps move their eyes', () => {
  const idle = renderToStaticMarkup(<ToolLineLogo />)
  const running = renderToStaticMarkup(<ToolLineLogo running />)

  assert.match(idle, /overlay-mark--none/)
  assert.doesNotMatch(idle, /overlay-mark--look/)
  assert.match(running, /overlay-mark--look/)
})
