import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_RUN_RUNNERS,
  canTransitionAgentRun,
  isActiveAgentRunStatus,
  isTerminalAgentRunStatus,
} from './agent-run'

describe('AgentRun lifecycle', () => {
  it('keeps remote execution behind the canonical runner discriminator', () => {
    assert.deepEqual(AGENT_RUN_RUNNERS, ['tool_loop', 'workflow', 'remote'])
  })
  it('allows only the declared forward transitions', () => {
    assert.equal(canTransitionAgentRun('queued', 'running'), true)
    assert.equal(canTransitionAgentRun('running', 'waiting_for_approval'), true)
    assert.equal(canTransitionAgentRun('waiting_for_approval', 'running'), true)
    assert.equal(canTransitionAgentRun('running', 'completed'), true)
    assert.equal(canTransitionAgentRun('completed', 'running'), false)
    assert.equal(canTransitionAgentRun('cancelled', 'completed'), false)
    assert.equal(canTransitionAgentRun('queued', 'completed'), false)
  })

  it('treats queued, running and approval waits as active', () => {
    assert.equal(isActiveAgentRunStatus('queued'), true)
    assert.equal(isActiveAgentRunStatus('running'), true)
    assert.equal(isActiveAgentRunStatus('waiting_for_approval'), true)
    assert.equal(isTerminalAgentRunStatus('failed'), true)
    assert.equal(isTerminalAgentRunStatus('cancelled'), true)
    assert.equal(isTerminalAgentRunStatus('completed'), true)
  })
})
