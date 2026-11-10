import assert from 'node:assert/strict'
import test from 'node:test'
import { routeSurfaceMessage } from './surface-routing'

const specialist = { bindingId: 'specialist', agentRole: 'agent' }
const chief = { bindingId: 'chief', agentRole: 'workspace_chief' }

test('no bound agents routes nowhere', () => {
  assert.deepEqual(routeSurfaceMessage({ candidates: [], text: 'hi' }), { kind: 'none' })
})

test('only the workspace Chief answers', () => {
  assert.deepEqual(routeSurfaceMessage({ candidates: [specialist, chief], text: 'review this' }), {
    kind: 'agent', candidate: chief, text: 'review this',
  })
})

test('specialist prefixes stay ordinary message text addressed to the Chief', () => {
  for (const text of ['PR agent review this', 'pr agent: review this', 'PR Agent, review this', '@PR agent — review this']) {
    const result = routeSurfaceMessage({ candidates: [specialist, chief], text })
    assert.equal(result.kind, 'agent', text)
    assert.equal(result.kind === 'agent' && result.candidate.bindingId, 'chief', text)
    assert.equal(result.kind === 'agent' && result.text, text, text)
  }
})

test('legacy specialist bindings and ambiguous Chief state route nowhere', () => {
  assert.deepEqual(routeSurfaceMessage({ candidates: [specialist], text: 'PR agent help' }), { kind: 'none' })
  assert.deepEqual(routeSurfaceMessage({ candidates: [chief, chief], text: 'help' }), { kind: 'none' })
})
