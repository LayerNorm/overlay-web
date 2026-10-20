import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolLineLogo } from './tool-rail'

test('every trace step uses the SVG orb in the trace icon slot, not a raster logo', () => {
  const markup = renderToStaticMarkup(<ToolLineLogo />)

  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /data-slot="trace-icon"/)
  assert.match(markup, /<svg/)
  assert.match(markup, /size-\[0\.5em\]/)
  assert.match(markup, /width="6.5"/)
  assert.match(markup, /aria-hidden="true"/)
})
