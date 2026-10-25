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

test('reported models use provider labels while legacy aliases do not claim a version', () => {
  const current = renderToStaticMarkup(<AgentModelField adapterId="claude-code" model="new-model"
    options={{ discoveredAt: 1, model: { values: [{ id: 'new-model', label: 'New provider model' }] } }} onChange={() => undefined} />)
  assert.match(current, /New provider model/)
  const legacy = renderToStaticMarkup(<AgentModelField adapterId="claude-code" model="haiku" onChange={() => undefined} />)
  assert.match(legacy, /Haiku · Version chosen by your runtime/)
  assert.doesNotMatch(legacy, /Haiku 4\.5|Haiku 5\.5/)
})

test('an older combined model renders the offered base model when the agent reports effort separately', () => {
  const options = {discoveredAt: 1, model: {values: [{id: 'future-model', label: 'Future model'}]},
    effort: {values: [{id: 'medium', label: 'Medium'}]}}
  const html = renderToStaticMarkup(<AgentModelField adapterId="codex" model="future-model[medium]"
    options={options} onChange={() => undefined} />)
  assert.match(html, /Future model/)
  assert.doesNotMatch(html, /No longer offered/)
  const unsupported = renderToStaticMarkup(<AgentModelField adapterId="codex" model="future-model[unknown]"
    options={options} onChange={() => undefined} />)
  assert.match(unsupported, /future-model\[unknown\] · No longer offered/)
})
