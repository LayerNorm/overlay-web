import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentAssignments, assignmentSummary, assignmentsByResponse } from './AgentAssignments'
import { assignmentThreadHref } from '@/components/layout/sidebar-nav'
import { AssignmentTrace, AssignmentTraceLine, assignmentTraceSummary } from './AssignmentTrace'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('ordinary conversations do not acquire an empty assignments panel', () => {
  assert.equal(renderToStaticMarkup(<AgentAssignments parent={null} assignments={[]} />), '')
})

test('assignments have independent links, live status labels and accessible collapse controls', () => {
  const html = renderToStaticMarkup(<AgentAssignments parent={null} assignments={[
    { assignmentId: 'one', title: 'Assess pipeline', agentName: 'Sales', status: 'running', href: '/agents?id=one' },
    { assignmentId: 'two', title: 'Check launch blockers', agentName: 'Product', status: 'completed', href: '/agents?id=two' },
    { assignmentId: 'three', title: 'Review customer feedback', agentName: 'Support', status: 'waiting_for_input', href: '/agents?id=three' },
  ]} />)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /aria-controls=/)
  assert.match(html, /1\/3 completed/)
  for (const label of ['Sales, Working', 'Product, Completed', 'Support, Needs you']) assert.ok(html.includes(label))
  for (const id of ['one', 'two', 'three']) assert.ok(html.includes(`href="/agents?id=${id}"`))
})

test('assignment threads link to their authorized parent without inventing sibling rows', () => {
  const html = renderToStaticMarkup(<AgentAssignments
    parent={{ assignmentId: 'one', title: 'Enterprise launch plan', href: '/agents?id=parent' }} assignments={[]}
  />)
  assert.match(html, /Assigned from/)
  assert.match(html, /href="\/agents\?id=parent"/)
  assert.doesNotMatch(html, /aria-expanded|completed/)
})

test('excluded failures stay failed', () => {
  assert.equal(renderToStaticMarkup(<AgentAssignments parent={null} assignments={[]} />), '')
  const html = renderToStaticMarkup(<AgentAssignments parent={null} assignments={[
    { assignmentId: 'failed', title: 'Pipeline', agentName: 'Sales', status: 'failed', disposition: 'excluded', dispositionReason: 'Source unavailable', href: '/app/agents?id=failed' },
    { assignmentId: 'publishing', title: 'Readiness', agentName: 'Product', status: 'publication_pending', href: '/app/agents?id=publishing' },
  ]} />)
  assert.match(html, /Sales · Failed/)
  assert.match(html, /Excluded: Source unavailable/)
  assert.match(html, /Product · Working/)
  assert.match(html, /0\/2 completed/)
})

test('Assigned from renders channel parent destinations without an agent filter', () => {
  const href = assignmentThreadHref({ agentId: 'chief', conversationId: 'channel', conversationType: 'channel', scope: 'workspace' })
  const html = renderToStaticMarkup(<AgentAssignments parent={{ assignmentId: 'one', title: 'Launch channel', href }} assignments={[]} />)
  assert.match(html, /href="\/app\/chat\?view=channels&amp;id=channel&amp;scope=workspace"/)
  assert.doesNotMatch(html, /agent=chief|\/app\/agents/)
})

test('assignments group under the response that made them, and untraceable ones stay apart', () => {
  const item = (assignmentId: string, messageId?: string) => ({ assignmentId, messageId, title: assignmentId, agentName: 'Sales', status: 'running', href: '#' })
  const { byMessage, unanchored } = assignmentsByResponse([item('a', 'm1'), item('b', 'm2'), item('c', 'm1'), item('d')])
  assert.deepEqual([...byMessage].map(([id, rows]) => [id, rows.map(row => row.assignmentId)]), [['m1', ['a', 'c']], ['m2', ['b']]])
  assert.deepEqual(unanchored.map(row => row.assignmentId), ['d'])
})

test('failed assignments say why and the summary counts them', () => {
  const rows = [
    { assignmentId: 'one', title: 'Pipeline', agentName: 'Sales', status: 'failed', failureReason: 'The model is not available on this plan', href: '#' },
    { assignmentId: 'two', title: 'Launch', agentName: 'Product', status: 'completed', href: '#' },
  ]
  assert.equal(assignmentSummary(rows), '1/2 completed · 1 failed')
  const html = renderToStaticMarkup(<AgentAssignments parent={null} assignments={rows} />)
  assert.match(html, /Sales · Failed/)
  assert.match(html, /The model is not available on this plan/)
})

test('a response shows its assignments as one collapsed row that summarises them', () => {
  const rows = [
    { assignmentId: 'one', title: 'Syllabus', agentName: 'Tutor', status: 'completed', href: '/a' },
    { assignmentId: 'two', title: 'Glossary', agentName: 'Quill', status: 'running', href: '/b' },
    { assignmentId: 'three', title: 'Review', agentName: 'Reviewer', status: 'failed', failureReason: 'Did not start', href: '/c' },
  ]
  assert.equal(assignmentTraceSummary(rows), 'Assigned 3 tasks · 1 completed · 1 working · 1 failed')
  assert.equal(assignmentTraceSummary(rows.slice(0, 1)), 'Assigned 1 task · 1 completed')
  const html = renderToStaticMarkup(<AssignmentTrace items={rows} />)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Assigned 3 tasks/)
  assert.doesNotMatch(html, /Glossary/)
  assert.equal(renderToStaticMarkup(<AssignmentTrace items={[]} />), '')
})

test('an assignment line links to its thread and a failed one says why', () => {
  const failed = renderToStaticMarkup(<AssignmentTraceLine item={{ assignmentId: 'x', title: 'Review', agentName: 'Reviewer', status: 'failed', failureReason: 'Did not start', href: '/thread' }} />)
  assert.match(failed, /href="\/thread"/)
  assert.match(failed, /Reviewer: Review/)
  assert.match(failed, /data-status="error"/)
  assert.match(failed, /Did not start/)
  const done = renderToStaticMarkup(<AssignmentTraceLine item={{ assignmentId: 'y', title: 'Quiz', agentName: 'Tutor', status: 'completed', failureReason: 'stale', href: '/t' }} />)
  assert.match(done, /Completed/)
  assert.doesNotMatch(done, /stale|data-status="error"/)
})
