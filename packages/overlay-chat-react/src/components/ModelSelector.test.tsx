import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSelector, filterModels, groupModelsByProvider } from './ModelSelector'
import { ModelQualitiesPanel } from './ModelQualitiesPanel'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const MODELS = [
  { id: 'auto', name: 'Auto', provider: 'openrouter' },
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'openai' },
]

test('Favorites and Recommended are independent collections and providers keep every model in quality order', () => {
  const sections = groupModelsByProvider(MODELS, {
    pinnedIds: ['auto'], favoriteIds: ['claude-opus'], recommendedIds: ['gpt-5'],
  })
  assert.deepEqual(sections.map((s) => s.id), ['favorites', 'recommended', 'provider:openrouter', 'provider:openai', 'provider:anthropic'])
  assert.deepEqual(sections[0].models.map((m) => m.id), ['claude-opus'])
  assert.deepEqual(sections[1].models.map((m) => m.id), ['auto', 'gpt-5'])
  assert.deepEqual(sections[2].models.map((m) => m.id), ['auto'])
  assert.deepEqual(sections[3].models.map((m) => m.id), ['gpt-5', 'gpt-5-mini'])
  assert.equal(sections[4].label, 'Anthropic')
  assert.equal(groupModelsByProvider(MODELS)[0].models.length, 0)
})

test('search matches names and professionally formatted provider names across all collections', () => {
  assert.deepEqual(filterModels(MODELS, 'anthropic').map((m) => m.id), ['claude-opus'])
  assert.deepEqual(filterModels(MODELS, 'mini').map((m) => m.id), ['gpt-5-mini'])
  assert.equal(filterModels([{ id: 'kimi', name: 'Kimi K2', provider: 'moonshotai' }], 'Moonshot AI').length, 1)
})

test('Recommended opens by default with a Favorites then grid rail and no inline capabilities', () => {
  const html = renderToStaticMarkup(
    <ModelSelector
      models={MODELS}
      recommendedIds={['gpt-5']}
      pinnedIds={['auto']}
      favoriteIds={[]}
      onToggleFavorite={() => {}}
      isSelected={(m) => m.id === 'gpt-5'}
      onSelect={() => {}}
    />,
  )
  const row = html.slice(html.indexOf('data-model-row="gpt-5"'))
  assert.ok(row.indexOf('data-slot="model-favorite"') < row.indexOf('lucide-check'))
  assert.ok(html.indexOf('aria-label="Favorites"') < html.indexOf('aria-label="Recommended"'))
  assert.match(html, /lucide-layout-grid/)
  assert.match(html, /data-provider="openai"/)
  assert.doesNotMatch(html, /lucide-brain-circuit|lucide-image/)
})

test('capabilities and capitalized providers render in model details', () => {
  const html = renderToStaticMarkup(<ModelQualitiesPanel model={{
    provider: 'moonshotai', supportsVision: true, supportsReasoning: true,
  }} />)
  assert.match(html, /Moonshot AI/)
  assert.match(html, /Vision/)
  assert.match(html, /Reasoning/)
})
