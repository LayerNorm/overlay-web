import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentAvatarPicker } from './AgentAvatarPicker'

function render(isDefault: boolean) {
  return renderToStaticMarkup(<AgentAvatarPicker
    isDefault={isDefault}
    shape="circle"
    color="#64748b"
    onShapeChange={() => assert.fail('render must not change shape')}
    onColorChange={() => assert.fail('render must not change color')}
  />)
}

test('the fixed default-agent mark exposes no avatar editing controls', () => {
  const html = render(true)
  assert.match(html, /aria-label="Overlay avatar"/)
  assert.match(html, /overlay-mark--blink/)
  assert.doesNotMatch(html, /<button|Edit avatar|Avatar shape|Avatar color/)
})

test('custom agents retain an accessible avatar editing trigger', () => {
  const html = render(false)
  assert.match(html, /<button/)
  assert.match(html, /aria-label="Edit avatar"/)
  assert.doesNotMatch(html, /overlay-mark--blink/)
})
