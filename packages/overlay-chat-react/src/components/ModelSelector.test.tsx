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
  assert.match(html, /overflow-x-hidden overflow-y-auto \[scrollbar-width:none\]/)
  assert.match(html, /\[&amp;::-webkit-scrollbar\]:hidden/)
  assert.doesNotMatch(html, /lucide-brain-circuit|lucide-image/)
})

test('locked models show a paid-plan lock and remain clickable for selection', () => {
  const html = renderToStaticMarkup(
    <ModelSelector
      models={MODELS}
      recommendedIds={['claude-opus']}
      favoriteIds={[]}
      onToggleFavorite={() => {}}
      isSelected={(model) => model.id === 'auto'}
      isLocked={(model) => model.id === 'claude-opus'}
      onSelect={() => {}}
    />,
  )
  const row = html.slice(html.indexOf('data-model-row="claude-opus"'))
  const modelButton = row.slice(0, row.indexOf('data-slot="model-favorite"'))
  const modelSelectedSlot = row.slice(row.indexOf('data-slot="model-selected"'))

  assert.match(row, /title="Paid plan"/)
  assert.match(row, /lucide-lock/)
  assert.match(row, /Paid plan/)
  assert.match(modelSelectedSlot, /text-\(--muted-light\)/)
  assert.match(modelSelectedSlot, /width="11"/)
  assert.match(modelSelectedSlot, /stroke-width="1.75"/)
  assert.doesNotMatch(modelButton, /disabled=""/)
  assert.doesNotMatch(modelButton, /disabled:opacity-40|disabled:cursor-not-allowed/)
  assert.doesNotMatch(row.slice(0, row.indexOf('<button')), /opacity-40/)
})

test('capabilities and capitalized providers render in model details', () => {
  const html = renderToStaticMarkup(<ModelQualitiesPanel model={{
    provider: 'moonshotai', supportsVision: true, supportsReasoning: true,
  }} />)
  assert.match(html, /Moonshot AI/)
  assert.match(html, /Vision/)
  assert.match(html, /Reasoning/)
})

test('duplicate model names retain source identity, connection labels and independent favorites', () => {
  const models = [
    { id: 'openai/gpt-5', name: 'GPT-5', provider: 'openai' },
    { id: 'byok/personal/gpt-5', name: 'GPT-5', provider: 'openai', sourceLabel: 'Subscription', connectionName: 'Personal ChatGPT' },
    { id: 'byok/key/gpt-5', name: 'GPT-5', provider: 'openai', sourceLabel: 'API key', connectionName: 'My API key' },
  ]
  const sections = groupModelsByProvider(models, { favoriteIds: ['byok/personal/gpt-5'] })
  assert.deepEqual(sections.find((section) => section.id === 'provider:openai')?.models.map((model) => model.id), models.map((model) => model.id))
  assert.deepEqual(sections[0].models.map((model) => model.id), ['byok/personal/gpt-5'])
  assert.deepEqual(filterModels(models, 'subscription').map((model) => model.id), ['byok/personal/gpt-5'])
  assert.deepEqual(filterModels(models, 'personal chatgpt').map((model) => model.id), ['byok/personal/gpt-5'])
  const html = renderToStaticMarkup(<ModelSelector models={models} recommendedIds={models.map((model) => model.id)} favoriteIds={['byok/personal/gpt-5']} onToggleFavorite={() => {}} isSelected={(model) => model.id === 'byok/personal/gpt-5'} onSelect={() => {}} />)
  assert.match(html, /Subscription/)
  assert.match(html, /Personal ChatGPT/)
  assert.match(html, /API key/)
  for (const model of models) assert.ok(html.includes(`data-model-row="${model.id}"`))
})
