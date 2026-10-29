import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentCreature } from './Creature'

test('only explicit default identity renders a blinking foreground O in the creature box', () => {
  const html = renderToStaticMarkup(<AgentCreature agent={{ name: 'Renamed assistant', avatarColor: '#db2777', avatarShape: 'cloud' }} isDefault size={32} />)
  assert.match(html, /width:32px;height:32px/)
  assert.match(html, /color:var\(--foreground\)/)
  assert.match(html, /width="26.88"/)
  assert.match(html, /overlay-mark--blink/)
  assert.match(html, /aria-label="Renamed assistant avatar"/)
  assert.doesNotMatch(html, /#db2777/)
})

test('name, gray color and legacy near-black never select the brand mark', () => {
  for (const avatarColor of [undefined, '#64748b', '#18181b']) {
    const html = renderToStaticMarkup(<AgentCreature agent={{ name: 'Overlay', avatarColor }} />)
    assert.doesNotMatch(html, /overlay-mark/)
    assert.match(html, /viewBox="0 0 100 100"/)
  }
  const legacy = renderToStaticMarkup(<AgentCreature agent={{ name: '', avatarColor: '#18181b' }} />)
  const gray = renderToStaticMarkup(<AgentCreature agent={{ name: '', avatarColor: '#64748b' }} />)
  assert.equal(legacy, gray)
})

test('unknown creature shapes retain the circle fallback and explicit false stays a creature', () => {
  const html = renderToStaticMarkup(<AgentCreature agent={{ name: 'Custom', avatarShape: 'unknown' }} isDefault={false} animated size={20} />)
  assert.match(html, /<circle cx="50" cy="53" r="40"/)
  assert.match(html, /width="20"/)
  assert.doesNotMatch(html, /overlay-mark/)
})

test('small default avatars use enlarged eyes inside the same box', () => {
  const html = renderToStaticMarkup(<AgentCreature agent={{ name: 'Assistant' }} isDefault size={20} />)
  assert.match(html, /width:20px;height:20px/)
  assert.match(html, /M347.0 -447.0A46.0/)
})
