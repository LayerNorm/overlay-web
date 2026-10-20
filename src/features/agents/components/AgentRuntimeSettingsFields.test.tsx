import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentRuntimeSettingsFields } from './AgentRuntimeSettingsFields'

Object.defineProperty(globalThis, 'React', { value: React, configurable: true })
const callbacks = { onModel() {}, onEffort() {}, onMode() {} }

test('undiscovered settings stay visible and disabled without inventing runtime choices', () => {
  const html = renderToStaticMarkup(<AgentRuntimeSettingsFields adapterId="claude-code" model="haiku" effort="high"
    mode="plan" disabled={false} {...callbacks} />)
  for (const name of ['Model', 'Reasoning effort', 'Permissions']) assert.ok(html.includes(`aria-label="${name}"`))
  assert.equal((html.match(/<button[^>]*role="combobox"[^>]*disabled=""/g) ?? []).length, 3)
  assert.match(html, /haiku · Not reported by agent/)
  assert.match(html, /high · Not reported by agent/)
  assert.match(html, /Plan · Not reported by agent/)
  assert.doesNotMatch(html, /Haiku 4\.5|Haiku 5\.5/)
})

test('live model labels and unsupported saved settings remain visible', () => {
  const html = renderToStaticMarkup(<AgentRuntimeSettingsFields adapterId="claude-code" model="haiku" effort="retired"
    mode="bypassPermissions" disabled={false} options={{ discoveredAt: 1,
      model: { values: [{ id: 'haiku', label: 'Haiku 5.5' }] },
      effort: { values: [{ id: 'high', label: 'High' }] },
      mode: { values: [{ id: 'default', label: 'Default' }] },
    }} {...callbacks} />)
  assert.match(html, /Haiku 5\.5/)
  assert.match(html, /retired · No longer offered/)
  assert.match(html, /Bypass permissions · No longer offered/)
})

test('unsaved effort does not adopt the discovery session default', () => {
  const html = renderToStaticMarkup(<AgentRuntimeSettingsFields adapterId="codex" model="" effort="" mode=""
    disabled={false} options={{ discoveredAt: 1, effort: { currentValue: 'high', values: [{ id: 'high', label: 'High' }] } }} {...callbacks} />)
  assert.match(html, /Agent default/)
  assert.doesNotMatch(html, />High</)
})
