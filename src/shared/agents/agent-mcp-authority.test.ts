import assert from 'node:assert/strict'
import test from 'node:test'
import { agentMcpAttemptMatches, agentMcpSessionIsLive } from './agent-mcp-authority'

const scope = { workspaceId: 'w', environmentId: 'e', runId: 'r', expiresAt: 200 }
const legacy = { id: 'first', workspaceId: 'w', environmentId: 'e', runId: 'r', status: 'running' }
const replacement = { ...legacy, id: 'second', attemptId: 'second', executionGeneration: 2, hardDeadlineAt: 190 }
const fenced = { ...scope, sessionId: 'second', execution: { attemptId: 'second', generation: 2 } }

test('legacy grants survive the first attempt but never a replacement or execution downgrade', () => {
  assert.equal(agentMcpSessionIsLive(scope, legacy, 100), true)
  assert.equal(agentMcpSessionIsLive(scope, { ...legacy, attemptId: 'first', executionGeneration: 1, hardDeadlineAt: 190 }, 100), true)
  assert.equal(agentMcpSessionIsLive(scope, replacement, 100), false)
  assert.equal(agentMcpSessionIsLive({ ...scope, sessionId: 'first' }, replacement, 100), false)
  assert.equal(agentMcpSessionIsLive(fenced, { ...legacy, id: 'second' }, 100), false)
  assert.equal(agentMcpSessionIsLive(fenced, replacement, 100), true)
  assert.equal(agentMcpSessionIsLive({ ...fenced, execution: { attemptId: 'second', generation: 1 } }, replacement, 100), false)
})

test('all tool requests stop on terminal, unknown, expired, wrong-scope and incomplete attempt state', () => {
  for (const status of ['cancelling', 'cancelled', 'completed', 'failed', 'needs_attention', 'unknown']) {
    assert.equal(agentMcpSessionIsLive(fenced, { ...replacement, status }, 100), false)
  }
  assert.equal(agentMcpSessionIsLive(fenced, { ...replacement, status: 'waiting_for_approval' }, 100), true)
  assert.equal(agentMcpSessionIsLive(fenced, replacement, 190), false)
  assert.equal(agentMcpSessionIsLive({ ...fenced, expiresAt: 100 }, replacement, 100), false)
  assert.equal(agentMcpSessionIsLive(fenced, { ...replacement, endedAt: 90 }, 100), false)
  assert.equal(agentMcpSessionIsLive(fenced, { ...replacement, hardDeadlineAt: undefined }, 100), false)
  assert.equal(agentMcpSessionIsLive(scope, { ...legacy, executionGeneration: 1 }, 100), false)
  for (const field of ['workspaceId', 'environmentId', 'runId']) {
    assert.equal(agentMcpSessionIsLive(fenced, { ...replacement, [field]: 'foreign' }, 100), false)
  }
  assert.equal(agentMcpSessionIsLive(fenced, null, 100), false)
  // An already-resolved denial may still be reported without granting execution.
  assert.equal(agentMcpAttemptMatches(fenced, { ...replacement, status: 'completed' }), true)
})
