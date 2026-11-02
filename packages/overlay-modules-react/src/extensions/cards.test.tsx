import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { McpServerSummary, SkillSummary } from '@overlay/app-core'
import { McpServersPanel } from './mcp'
import { SkillsPanel } from './skills'
import { Field, FieldSelect } from './shared'

test('MCP cards use shared Card anatomy and expose connection states without claiming unauthenticated servers are connected', () => {
  const base: McpServerSummary = { _id: 'mcp', name: 'Monid', url: 'https://mcp.monid.ai/v1', transport: 'streamable-http', enabled: true, authType: 'oauth', createdAt: 1, updatedAt: 1 }
  for (const [overrides, status] of [
    [{ oauthStatus: 'pending' }, 'Not connected'],
    [{ oauthStatus: 'connected', toolCatalogCount: 0 }, 'Connected'],
    [{ oauthStatus: 'needs_reauth' }, 'Connection error'],
    [{ enabled: false }, 'Inactive'],
    [{ authType: 'none' }, 'Active'],
  ] as const) {
    const server = { ...base, ...overrides }
    const html = renderToStaticMarkup(<McpServersPanel loading={false} servers={[server]} filteredServers={[server]} onEdit={() => {}} onToggle={() => {}} />)
    for (const slot of ['card', 'card-header', 'card-title', 'card-description', 'card-content', 'card-footer']) assert.ok(html.includes(`data-slot="${slot}"`))
    assert.ok(html.includes(status))
    assert.match(html, /aria-label="Manage Monid"/)
    assert.match(html, /mcp.monid.ai/)
    assert.doesNotMatch(html, /border-t |border-b /)
    if ('toolCatalogCount' in overrides) assert.match(html, /0 tools/)
  }
})

test('Skills cards have a visible keyboard-accessible Manage action and active state', () => {
  for (const enabled of [true, false]) {
    const skill: SkillSummary = { _id: 'skill', name: 'Writing', description: 'Write clearly', instructions: 'Instructions', enabled }
    const html = renderToStaticMarkup(<SkillsPanel loading={false} skills={[skill]} filteredSkills={[skill]} onEdit={() => {}} onToggle={() => {}} />)
    assert.match(html, /data-slot="card"/)
    assert.match(html, /aria-label="Manage Writing"/)
    assert.ok(html.includes(enabled ? 'Active' : 'Inactive'))
    assert.doesNotMatch(html, /border-t |border-b /)
  }
})

test('Field labels point to the shared Select trigger', () => {
  const html = renderToStaticMarkup(<Field label="Authentication"><FieldSelect value="oauth" onChange={() => {}} options={[{ value: 'oauth', label: 'OAuth' }]} /></Field>)
  const id = html.match(/for="([^"]+)"/)?.[1]
  assert.ok(id)
  assert.ok(html.includes(`id="${id}"`))
  assert.match(html, /role="combobox"/)
})
