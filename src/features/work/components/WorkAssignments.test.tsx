import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentExecution } from '@/shared/work/assignment-execution'
import { WorkAssignmentGroup, WorkAssignmentPeek, WorkAssignmentRow } from './WorkAssignments'

Object.assign(globalThis, { React })

const item: AssignmentExecution = {
  kind: 'agent_assignment', assignmentId: 'assignment', attemptOrdinal: 1,
  conversationId: 'child', agentId: 'agent', agentName: 'Research', agent: {},
  title: 'Research the launch', brief: 'Find blockers', scope: 'personal', status: 'running',
  parent: { conversationId: 'parent', agentId: 'chief', title: 'Launch', scope: 'personal' }, createdAt: 1,
}

test('assignment titles use the same native keyboard activation pattern as task rows', () => {
  const opened: string[] = []
  const row = WorkAssignmentRow({ item, selected: false, onOpen: id => opened.push(id) })
  const html = renderToStaticMarkup(row)
  assert.match(html, /<button\b[^>]*type="button"[^>]*>Research the launch<\/button>/)
  assert.doesNotMatch(html, /tabindex="-1"|disabled=""/)
  row.props.onClick()
  assert.deepEqual(opened, ['assignment'])
})

for (const attemptOrdinal of [1, 2, undefined]) {
  test(`peek shows attempt metadata for ordinal ${attemptOrdinal}`, () => {
    const html = renderToStaticMarkup(<WorkAssignmentPeek assignmentId="assignment" items={[{ ...item, attemptOrdinal }]} loading={false} onClose={() => {}} />)
    assert.match(html, />Attempt<\/div>/)
    assert.match(html, new RegExp(`>Attempt ${attemptOrdinal ?? 1}(?:<| )`))
    assert.equal(html.includes('revised in the same thread'), (attemptOrdinal ?? 1) > 1)
  })
}

test('empty groups and unavailable or loading assignments retain their fallback states', () => {
  assert.equal(renderToStaticMarkup(<WorkAssignmentGroup items={[]} selectedId={null} onOpen={() => {}} canLoadMore={false} onLoadMore={() => {}} />), '')
  assert.match(renderToStaticMarkup(<WorkAssignmentPeek assignmentId="missing" items={[]} loading={false} onClose={() => {}} />), /This assignment is not available/)
  assert.match(renderToStaticMarkup(<WorkAssignmentPeek assignmentId="missing" items={[]} loading onClose={() => {}} />), /Loading assignment/)
})
