import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceSearchResult } from '@/shared/search/workspace-search'
import { SharedWithMeList } from './SharedWithMeList'
import { MentionSuggestionList, mentionOptionId } from '@/components/mentions/MentionSuggestionList'

const RESULTS: WorkspaceSearchResult[] = [
  {
    kind: 'file',
    id: 'file_1',
    title: 'Admissions research',
    accessRole: 'editor',
    sharedVia: 'direct',
  },
  {
    kind: 'project',
    id: 'project_1',
    title: 'Launch program',
    accessRole: 'viewer',
    sharedVia: 'team',
  },
  {
    kind: 'automation',
    id: 'automation_1',
    title: 'Weekly digest',
    accessRole: 'operator',
    sharedVia: 'room',
  },
]

function render(state: Parameters<typeof SharedWithMeList>[0]['state']) {
  return renderToStaticMarkup(
    <SharedWithMeList state={state} hrefFor={(result) => `/app/x/${result.id}`} onRetry={() => undefined} />,
  )
}

test('shared with me renders loading, error, and empty states', () => {
  assert.match(render({ status: 'loading' }), /shared-with-me-loading/)
  const error = render({ status: 'error', message: 'Request failed' })
  assert.match(error, /shared-with-me-error/)
  assert.match(error, /Request failed/)
  assert.match(error, /Try again/)
  const empty = render({ status: 'ready', results: [] })
  assert.match(empty, /shared-with-me-empty/)
  assert.match(empty, /Nothing shared with you yet/)
})

test('shared resources are grouped by kind and explain how access arrives', () => {
  const html = render({ status: 'ready', results: RESULTS })
  assert.match(html, /shared-with-me-list/)
  assert.match(html, /Files/)
  assert.match(html, /Projects/)
  assert.match(html, /Automations/)
  assert.match(html, /Can edit · shared with you/)
  assert.match(html, /Can view · through a team/)
  assert.match(html, /Can run · through a room/)
})

test('mention suggestions expose a keyboard listbox with an active option', () => {
  const html = renderToStaticMarkup(
    <MentionSuggestionList
      suggestions={[
        { principalId: 'p_maya', displayName: 'Maya', principalType: 'human' },
        { principalId: 'p_scout', displayName: 'Scout', principalType: 'agent' },
      ]}
      activeIndex={1}
      onSelect={() => undefined}
    />,
  )
  assert.match(html, /role="listbox"/)
  assert.match(html, /aria-label="People and agents"/)
  assert.match(html, new RegExp(`id="${mentionOptionId('p_scout')}"`))
  assert.match(html, /aria-selected="true"[^>]*>|aria-selected="true"/)
  assert.match(html, /Agent/)
})

test('an empty suggestion list renders nothing at all', () => {
  const html = renderToStaticMarkup(
    <MentionSuggestionList suggestions={[]} activeIndex={0} onSelect={() => undefined} />,
  )
  assert.equal(html, '')
})
