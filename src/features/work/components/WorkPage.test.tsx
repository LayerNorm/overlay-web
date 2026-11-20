import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkItem } from '@overlay/app-core'
import type { AssignmentExecution } from '@/shared/work/assignment-execution'
import { WorkBody } from './WorkPage'

Object.assign(globalThis, { React })

const assignment: AssignmentExecution = {
  kind: 'agent_assignment', assignmentId: 'assignment', conversationId: 'child',
  agentId: 'agent', agentName: 'Research', agent: {}, title: 'Research the launch',
  brief: 'Find blockers', scope: 'workspace', status: 'running', createdAt: 1,
  parent: { conversationId: 'parent', agentId: 'chief', title: 'Launch', scope: 'workspace' },
}

function render(overrides: Partial<React.ComponentProps<typeof WorkBody>> = {}) {
  return renderToStaticMarkup(<WorkBody data={{ state: 'ready', items: [], byId: new Map() }}
    view="list" scope="workspace" solo={false} visible={[]} filtering={false} today="2026-11-10"
    selectedId={null} onOpen={() => {}}
    assignments={{ items: [], selectedId: null, onOpen: () => {}, canLoadMore: false, onLoadMore: () => {} }}
    {...overrides} />)
}

for (const view of ['list', 'board', 'timeline'] as const) {
  test(`${view}: search with no matching tasks or assignments uses the existing no-results state`, () => {
    for (const items of [[], [{ id: 'nonmatching-task' } as WorkItem]]) {
      const html = render({ view, filtering: true, data: { state: 'ready', items, byId: new Map() } })
      assert.match(html, /Nothing matches/)
      assert.match(html, /Try another search\./)
      assert.doesNotMatch(html, /No tasks yet|Tasks added to the workspace/)
    }
  })
}

test('assignment-only lists do not place the task empty state above the group', () => {
  for (const filtering of [false, true]) {
    const html = render({ filtering, assignments: {
      items: [assignment], selectedId: null, onOpen: () => {}, canLoadMore: false, onLoadMore: () => {},
    } })
    assert.match(html, /Agent assignments/)
    assert.match(html, /Research the launch/)
    assert.doesNotMatch(html, /No tasks yet|Nothing matches|data-testid="work-empty"/)
  }
})

test('true empty states preserve workspace, personal and solo onboarding copy without a search', () => {
  assert.match(render(), /No tasks yet.*Tasks added to the workspace are shared with its members\./)
  assert.match(render({ scope: 'personal' }), /No tasks yet.*Describe a task below\. It lands in Todo\./)
  assert.match(render({ solo: true }), /No tasks yet.*Describe a task below\. It lands in Todo\./)
})

test('loading, signed-out and access-error states retain priority over search', () => {
  for (const [state, message] of [['loading', 'Loading tasks'], ['signed_out', 'Sign in to see your tasks'], ['error', 'Could not load tasks']] as const) {
    const html = render({ filtering: true, data: { state, items: [], byId: new Map() } })
    assert.ok(html.includes(message))
    assert.doesNotMatch(html, /Nothing matches|No tasks yet/)
  }
})
