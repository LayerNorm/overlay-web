import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSelector, filterModels, groupModelsByProvider } from './ModelSelector'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const MODELS = [
  { id: 'auto', name: 'Auto', provider: 'openrouter' },
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'openai' },
]

test('groups keep quality order: pinned, favorites, then providers by their best model', () => {
  const sections = groupModelsByProvider(MODELS, { pinnedIds: ['auto'], favoriteIds: ['claude-opus'] })
  assert.deepEqual(sections.map((s) => s.id), ['pinned', 'favorites', 'provider:openai', 'provider:anthropic'])
  assert.deepEqual(sections[2].models.map((m) => m.id), ['gpt-5', 'gpt-5-mini'])
  assert.equal(sections[3].label, 'Anthropic')
})

test('search matches name and provider label as one flat list', () => {
  assert.deepEqual(filterModels(MODELS, 'anthropic').map((m) => m.id), ['claude-opus'])
  assert.deepEqual(filterModels(MODELS, 'mini').map((m) => m.id), ['gpt-5-mini'])
})

test('rows put the favorite star and selected check before capability badges', () => {
  const html = renderToStaticMarkup(
    <ModelSelector
      models={MODELS}
      pinnedIds={['auto']}
      favoriteIds={[]}
      onToggleFavorite={() => {}}
      isSelected={(m) => m.id === 'gpt-5'}
      onSelect={() => {}}
      renderBadges={() => <span data-testid="badges" />}
    />,
  )
  const row = html.slice(html.indexOf('data-model-row="gpt-5"'))
  const star = row.indexOf('data-slot="model-favorite"')
  const check = row.indexOf('lucide-check')
  const badges = row.indexOf('data-testid="badges"')
  assert.ok(star > 0 && star < check && check < badges)
  assert.match(html, /role="tablist" aria-label="Providers"/)
  assert.match(html, /data-provider="openai"/)
})
