import assert from 'node:assert/strict'
import test from 'node:test'
import { agentLineagePart, lineageForTriggerMessage, MAX_AGENT_HOPS, nextLineage, nextLineageForMentions } from './agent-lineage'

const start = lineageForTriggerMessage({ authorKind: 'human', turnId: 'turn-1' }, 'scout')

test('a turn a person started is hop 0 and rooted at that message', () => {
  assert.deepEqual(start, { rootTurnId: 'turn-1', hop: 0, chain: ['scout'] })
})

test('asking another agent moves one hop on and extends the chain', () => {
  const next = nextLineage({ lineage: start, callerAgentId: 'scout', callerName: 'Scout', targetAgentId: 'planner', asksSoFarThisTurn: 0 })
  assert.ok(next.ok)
  assert.deepEqual(next.lineage, { rootTurnId: 'turn-1', hop: 1, chain: ['scout', 'planner'], askedByAgentId: 'scout', askedByName: 'Scout' })
})

test('the asked agent reads its lineage back from the question that triggered it', () => {
  const next = nextLineage({ lineage: start, callerAgentId: 'scout', targetAgentId: 'planner', asksSoFarThisTurn: 0 })
  assert.ok(next.ok)
  const question = { authorKind: 'agent', turnId: 'ask-1', parts: [{ type: 'text', text: 'hi' }, agentLineagePart(next.lineage)] }
  assert.deepEqual(lineageForTriggerMessage(question, 'planner'), next.lineage)
})

test('a person cannot start a chain at a later hop by putting a lineage in their own message', () => {
  const forged = agentLineagePart({ rootTurnId: 'x', hop: 0, chain: [] })
  const human = lineageForTriggerMessage({ authorKind: 'human', turnId: 'turn-9', parts: [forged] }, 'scout')
  assert.deepEqual(human, { rootTurnId: 'turn-9', hop: 0, chain: ['scout'] })
  const junk = lineageForTriggerMessage({ authorKind: 'agent', turnId: 't', parts: [{ type: 'data-agent-lineage', data: { hop: 'zero' } }] }, 'a')
  assert.deepEqual(junk, { rootTurnId: 't', hop: 0, chain: ['a'] })
})

test('self-calls, cycles, too many hops, and too many questions in one turn are refused', () => {
  assert.deepEqual(nextLineage({ lineage: start, callerAgentId: 'scout', targetAgentId: 'scout', asksSoFarThisTurn: 0 }), { ok: false, refusal: 'self' })

  const b = nextLineage({ lineage: start, callerAgentId: 'scout', targetAgentId: 'planner', asksSoFarThisTurn: 0 })
  assert.ok(b.ok)
  assert.deepEqual(nextLineage({ lineage: b.lineage, callerAgentId: 'planner', targetAgentId: 'scout', asksSoFarThisTurn: 0 }), { ok: false, refusal: 'cycle' })

  let lineage = start
  let caller = 'scout'
  for (let i = 0; i < MAX_AGENT_HOPS; i += 1) {
    const step = nextLineage({ lineage, callerAgentId: caller, targetAgentId: `agent-${i}`, asksSoFarThisTurn: 0 })
    assert.ok(step.ok, `hop ${i + 1} is allowed`)
    lineage = step.lineage
    caller = `agent-${i}`
  }
  assert.deepEqual(nextLineage({ lineage, callerAgentId: caller, targetAgentId: 'one-too-many', asksSoFarThisTurn: 0 }), { ok: false, refusal: 'hop_limit' })

  assert.deepEqual(nextLineage({ lineage: start, callerAgentId: 'scout', targetAgentId: 'planner', asksSoFarThisTurn: 3 }), { ok: false, refusal: 'turn_limit' })
})

test('one message that mentions several agents is checked for each and puts all of them in the chain, one hop on', () => {
  const ok = nextLineageForMentions({ lineage: start, callerAgentId: 'scout', callerName: 'Scout', targetAgentIds: ['planner', 'writer'], parentConversationId: 'room-1' })
  assert.ok(ok.ok)
  assert.deepEqual(ok.lineage, { rootTurnId: 'turn-1', hop: 1, chain: ['scout', 'planner', 'writer'], askedByAgentId: 'scout', askedByName: 'Scout', parentConversationId: 'room-1' })
  assert.deepEqual(nextLineageForMentions({ lineage: start, callerAgentId: 'scout', targetAgentIds: ['planner', 'scout'] }), { ok: false, refusal: 'self' })
  const b = nextLineage({ lineage: start, callerAgentId: 'scout', targetAgentId: 'planner', asksSoFarThisTurn: 0 })
  assert.ok(b.ok)
  assert.deepEqual(nextLineageForMentions({ lineage: b.lineage, callerAgentId: 'planner', targetAgentIds: ['writer', 'scout'] }), { ok: false, refusal: 'cycle' })
  assert.deepEqual(nextLineageForMentions({ lineage: start, callerAgentId: 'scout', targetAgentIds: [] }), { ok: false, refusal: 'self' })
})
