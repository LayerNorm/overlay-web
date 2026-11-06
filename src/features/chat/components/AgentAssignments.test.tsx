import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentAssignments } from './AgentAssignments'

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
