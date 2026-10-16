import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentModelField } from './AgentModelField'

Object.defineProperty(globalThis, 'React', { value: React, configurable: true })

test('a discovered agent with no model catalog does not advertise the legacy hard-coded models', () => {
  const html = renderToStaticMarkup(<AgentModelField adapterId="claude-code" model="haiku"
    options={{ discoveredAt: 1 }} onChange={() => undefined} />)
  assert.match(html, /haiku · Not reported by agent/)
  assert.doesNotMatch(html, /Haiku 4\.5|Fastest for quick answers/)
})

test('a reported model uses its provider label while undiscovered legacy agents retain their existing label', () => {
  const current = renderToStaticMarkup(<AgentModelField adapterId="claude-code" model="new-model"
    options={{ discoveredAt: 1, model: { values: [{ id: 'new-model', label: 'New provider model' }] } }} onChange={() => undefined} />)
  assert.match(current, /New provider model/)
  const legacy = renderToStaticMarkup(<AgentModelField adapterId="claude-code" model="haiku" onChange={() => undefined} />)
  assert.match(legacy, /Haiku 4\.5/)
})
