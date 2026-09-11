import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolLineLogo } from './tool-rail'

test('tool rail renders the SVG orb mark, not a raster logo', () => {
  const markup = renderToStaticMarkup(<ToolLineLogo />)

  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /<svg/)
  assert.match(markup, /width="8"/)
  assert.match(markup, /height="8"/)
  assert.match(markup, /mt-\[5px\]/)
  assert.match(markup, /aria-hidden="true"/)
})
