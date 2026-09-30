import assert from 'node:assert/strict'
import test from 'node:test'
import { ambiguousAgentPrompt, routeSurfaceMessage } from './surface-routing'

const pr = { bindingId: 'b_pr', agentName: 'PR agent' }
const product = { bindingId: 'b_product', agentName: 'Product Agent' }
const productOps = { bindingId: 'b_ops', agentName: 'Product Agent Ops' }

test('no bound agents routes nowhere', () => {
  assert.deepEqual(routeSurfaceMessage({ candidates: [], text: 'hi' }), { kind: 'none' })
})

test('a single bound agent answers everything, as before', () => {
  assert.deepEqual(routeSurfaceMessage({ candidates: [pr], text: 'review this' }), {
    kind: 'agent', candidate: pr, text: 'review this',
  })
})

test('a leading agent name picks that agent and is stripped from the prompt', () => {
  for (const text of ['PR agent review this', 'pr agent: review this', 'PR Agent, review this', '@PR agent — review this']) {
    const result = routeSurfaceMessage({ candidates: [pr, product], text })
    assert.equal(result.kind, 'agent', text)
    assert.equal(result.kind === 'agent' && result.candidate.bindingId, 'b_pr', text)
    assert.equal(result.kind === 'agent' && result.text, 'review this', text)
  }
})

test('the longest matching name wins and names must end at a word boundary', () => {
  const result = routeSurfaceMessage({ candidates: [product, productOps], text: 'Product Agent Ops check alerts' })
  assert.equal(result.kind === 'agent' && result.candidate.bindingId, 'b_ops')
  // "PR agents" is not "PR agent".
  const plural = routeSurfaceMessage({ candidates: [pr, product], text: 'PR agents are great' })
  assert.equal(plural.kind, 'ambiguous')
})

test('thread follow-ups stay with the thread owner unless another agent is named', () => {
  const followUp = routeSurfaceMessage({ candidates: [pr, product], text: 'and the tests?', threadBindingId: 'b_product' })
  assert.equal(followUp.kind === 'agent' && followUp.candidate.bindingId, 'b_product')
  const handoff = routeSurfaceMessage({ candidates: [pr, product], text: 'PR agent take over', threadBindingId: 'b_product' })
  assert.equal(handoff.kind === 'agent' && handoff.candidate.bindingId, 'b_pr')
})

test('an unnamed message in a shared channel is ambiguous and lists the agents', () => {
  const result = routeSurfaceMessage({ candidates: [pr, product], text: 'can someone help?' })
  assert.deepEqual(result, { kind: 'ambiguous', agentNames: ['PR agent', 'Product Agent'] })
  assert.match(ambiguousAgentPrompt(['PR agent', 'Product Agent']), /\*PR agent\*, \*Product Agent\*.*`@Overlay PR agent …`/)
})
