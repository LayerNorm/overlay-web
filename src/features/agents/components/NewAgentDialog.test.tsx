import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NewAgentFields,
  initialNewAgentDraft,
  isNewAgentDraftValid,
  resolveDraftModelId,
} from './NewAgentDialog'

// Package components compile with the classic JSX runtime under the app's
// tsconfig, so they resolve React from the global.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const models = [{ value: 'test-model', label: 'Test model' }]

test('new agents default to every tool except computer, private, no computer', () => {
  const draft = initialNewAgentDraft()
  assert.equal(draft.visibility, 'creator')
  assert.equal(draft.computer, false)
  assert.equal(draft.toolGroups.has('computer'), false)
  assert.equal(draft.toolGroups.has('web_search'), true)
})

test('a draft needs a name and a description', () => {
  const draft = { ...initialNewAgentDraft(), modelId: 'test-model' }
  assert.equal(isNewAgentDraftValid(draft), false)
  assert.equal(isNewAgentDraftValid({ ...draft, name: 'Scout' }), false)
  assert.equal(isNewAgentDraftValid({ ...draft, name: 'Scout', instructions: 'Find evidence.' }), true)
  assert.equal(isNewAgentDraftValid({ ...draft, name: '  ', instructions: 'Find evidence.' }), false)
})

test('an unavailable default model falls back to the first enabled one', () => {
  assert.equal(resolveDraftModelId('paid-model', models), 'test-model')
  assert.equal(resolveDraftModelId('test-model', models), 'test-model')
  assert.equal(resolveDraftModelId('paid-model', []), 'paid-model')
})

test('fields render in order with other agents disabled', () => {
  const markup = renderToStaticMarkup(
    <NewAgentFields draft={{ ...initialNewAgentDraft(), modelId: 'test-model' }} onChange={() => undefined} modelOptions={models} computersAvailable />,
  )
  const order = ['Edit avatar', '>Name<', '>Description<', '>Type<', '>Computer<', '>Access<', '>Advanced<']
  const positions = order.map((needle) => markup.indexOf(needle))
  assert.ok(positions.every((position) => position >= 0), `missing field: ${order[positions.indexOf(-1)]}`)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.match(markup, /Other agent: Coming soon/)
  assert.match(markup, /<button[^>]*aria-label="Other agent: Coming soon"[^>]*disabled=""/)
})

test('the computer row is hidden when the deployment has no computers', () => {
  const markup = renderToStaticMarkup(
    <NewAgentFields draft={initialNewAgentDraft()} onChange={() => undefined} modelOptions={models} computersAvailable={false} />,
  )
  assert.doesNotMatch(markup, />Computer</)
})

test('an agent on Overlay Cloud needs a name and an account, not instructions', () => {
  const draft = { ...initialNewAgentDraft(), kind: 'other' as const }
  assert.equal(isNewAgentDraftValid(draft), false)
  assert.equal(isNewAgentDraftValid({ ...draft, name: 'Coder' }), false)
  const withAccount = { ...draft, name: 'Coder', other: { ...draft.other, providerAccountId: 'acct-1' } }
  assert.equal(isNewAgentDraftValid(withAccount), true)
  // "Your machine" is set up in the full editor, so the dialog cannot create it.
  assert.equal(isNewAgentDraftValid({ ...withAccount, other: { ...withAccount.other, runsOn: 'machine' } }), false)
})

test('other agents are selectable where cloud agents are available, and show their own fields', () => {
  const draft = { ...initialNewAgentDraft(), kind: 'other' as const, modelId: 'test-model' }
  const markup = renderToStaticMarkup(
    <NewAgentFields draft={draft} onChange={() => undefined} modelOptions={models} computersAvailable otherAgentsAvailable />,
  )
  assert.doesNotMatch(markup, /Other agent: Coming soon/)
  const order = ['>Type<', '>Agent<', '>Runs on<', '>Account<', '>Machine<', '>Access<']
  const positions = order.map((needle) => markup.indexOf(needle))
  assert.ok(positions.every((position) => position >= 0), `missing field: ${order[positions.indexOf(-1)]}`)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  // The agent brings its own model and tools; the machine is its computer.
  assert.doesNotMatch(markup, />Advanced</)
  assert.doesNotMatch(markup, />Computer</)
})
