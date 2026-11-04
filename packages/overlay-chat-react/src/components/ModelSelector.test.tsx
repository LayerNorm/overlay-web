import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSelector, filterModels, groupModelsByProvider } from './ModelSelector'
import { ModelQualitiesPanel } from './ModelQualitiesPanel'
import { ModelReasoningControl, modelReasoningLabel } from './ModelReasoningControl'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const MODELS = [
  { id: 'auto', name: 'Auto', provider: 'openrouter' },
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'openai' },
]

test('reasoning controls are text-only, model-specific, and disabled for unavailable subscriptions', () => {
  const model = { id: 'byok/personal/sol', name: 'Sol', provider: 'openai',
    reasoningLevels: [{ value: 'low' as const, label: 'Low' }, { value: 'high' as const, label: 'High' }],
    subscription: { connectionId: 'personal', scopeLabel: 'Personal', unavailable: true, recoveryHref: '/settings' } }
  const html = renderToStaticMarkup(<ModelSelector models={[model]} recommendedIds={[model.id]} favoriteIds={[]}
    onToggleFavorite={() => {}} onSelect={() => {}} isSelected={() => true}
    reasoningByModel={{ [model.id]: 'high', 'byok/another/sol': 'low' }} onModelReasoningChange={() => {}} />)
  assert.match(html, /aria-label="Reasoning for Sol"/)
  assert.match(html, /role="combobox"[^>]*disabled=""/)
  assert.match(html, />High</)
  assert.doesNotMatch(html, /lucide-sparkles|lucide-brain/)
  assert.match(html, /data-slot="model-favorite"/)
  assert.equal(modelReasoningLabel(model, 'xhigh'), 'Default')
})

test('models without advertised reasoning levels remain provider managed', () => {
  const model = { id: 'custom', name: 'Custom' }
  const html = renderToStaticMarkup(<ModelReasoningControl model={model} value="high" onChange={() => {}} />)
  assert.match(html, /Provider managed/)
  assert.doesNotMatch(html, /combobox/)
  assert.equal(modelReasoningLabel(model, 'high'), 'Provider managed')
})

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
    { id: 'byok/personal/gpt-5', name: 'GPT-5', provider: 'openai', sourceLabel: 'Subscription', connectionName: 'Personal ChatGPT', subscription: { connectionId: 'personal', scopeLabel: 'Personal', recoveryHref: '/app/settings?section=providers&reconnect=personal' } },
    { id: 'byok/key/gpt-5', name: 'GPT-5', provider: 'openai', sourceLabel: 'API key', connectionName: 'My API key' },
  ]
  const sections = groupModelsByProvider(models, { favoriteIds: ['byok/personal/gpt-5'] })
  assert.deepEqual(sections.find((section) => section.id === 'provider:openai')?.models.map((model) => model.id), ['openai/gpt-5', 'byok/key/gpt-5'])
  assert.equal(sections[2].id, 'subscription:personal')
  assert.deepEqual(sections[0].models.map((model) => model.id), ['byok/personal/gpt-5'])
  assert.deepEqual(filterModels(models, 'subscription').map((model) => model.id), ['byok/personal/gpt-5'])
  assert.deepEqual(filterModels(models, 'personal chatgpt').map((model) => model.id), ['byok/personal/gpt-5'])
  const html = renderToStaticMarkup(<ModelSelector models={models} recommendedIds={models.map((model) => model.id)} favoriteIds={['byok/personal/gpt-5']} onToggleFavorite={() => {}} isSelected={(model) => model.id === 'byok/personal/gpt-5'} onSelect={() => {}} />)
  assert.match(html, /subscription-badge/)
  assert.match(html, /Personal ChatGPT/)
  assert.match(html, /API key/)
  for (const model of models) assert.ok(html.includes(`data-model-row="${model.id}"`))
})

test('connections get distinct sections below Recommended, preserving catalog order and scope search', () => {
  const models = ['personal', 'team'].flatMap((connectionId) => ['sol', 'luna'].map((model) => ({
    id: `byok/${connectionId}/${model}`, name: model, provider: 'openai', connectionName: 'ChatGPT',
    sourceLabel: 'Subscription', subscription: { connectionId, scopeLabel: connectionId === 'team' ? 'Acme workspace' : 'Personal', recoveryHref: '/app/settings?section=providers' },
  })))
  const sections = groupModelsByProvider([...MODELS, ...models])
  assert.deepEqual(sections.slice(0, 5).map((section) => section.id), ['favorites', 'recommended', 'subscription:personal', 'subscription:team', 'provider:openrouter'])
  assert.deepEqual(sections[2].models.map((model) => model.name), ['sol', 'luna'])
  assert.deepEqual(filterModels(models, 'Acme workspace').map((model) => model.id), ['byok/team/sol', 'byok/team/luna'])
})

test('unavailable subscription models retain favorites and selection but disable dispatch with a reconnect link', () => {
  const model = { id: 'byok/expired/sol', name: 'Sol', provider: 'openai', connectionName: 'ChatGPT',
    subscription: { connectionId: 'expired', scopeLabel: 'Personal', unavailable: true, recoveryHref: '/app/settings?section=providers&reconnect=expired' },
    supportsVision: true, supportsReasoning: true }
  const html = renderToStaticMarkup(<ModelSelector models={[model]} recommendedIds={[model.id]} favoriteIds={[model.id]} onToggleFavorite={() => {}} isSelected={() => true} onSelect={() => {}} />)
  assert.match(html, /Reconnect ChatGPT/)
  assert.match(html, /reconnect=expired/)
  assert.match(html, /No alternate model will be used/)
  const row = html.slice(html.indexOf('data-model-row='))
  assert.match(row.slice(0, row.indexOf('data-slot="model-favorite"')), /disabled=""/)
  assert.ok(row.indexOf('data-slot="model-selected"') < row.indexOf('lucide-scan-eye'))
  assert.doesNotMatch(row, /lucide-sparkles/)
})
