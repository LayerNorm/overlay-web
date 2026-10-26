import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTIVE_AGENT_RUN_STATUSES,
  AGENT_RUN_STATUSES,
  AGENT_RUN_RUNNERS,
  canTransitionAgentRun,
  isActiveAgentRunStatus,
  isTerminalAgentRunStatus,
} from './agent-run'

describe('AgentRun lifecycle', () => {
  it('keeps remote execution behind the canonical runner discriminator', () => {
    assert.deepEqual(AGENT_RUN_RUNNERS, ['tool_loop', 'workflow', 'remote'])
  })
  it('composes all statuses from canonical active and terminal statuses', () => {
    assert.deepEqual(ACTIVE_AGENT_RUN_STATUSES, [
      'queued',
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'waiting_for_children',
    ])
    assert.deepEqual(AGENT_RUN_STATUSES, [
      ...ACTIVE_AGENT_RUN_STATUSES,
      'completed',
      'failed',
      'cancelled',
    ])
  })
  it('allows only the declared forward transitions', () => {
    assert.equal(canTransitionAgentRun('queued', 'running'), true)
    assert.equal(canTransitionAgentRun('running', 'waiting_for_approval'), true)
    assert.equal(canTransitionAgentRun('waiting_for_approval', 'running'), true)
    for (const status of ['waiting_for_input', 'waiting_for_children'] as const) {
      assert.equal(canTransitionAgentRun('running', status), true)
      assert.equal(canTransitionAgentRun(status, 'running'), true)
      assert.equal(canTransitionAgentRun(status, 'failed'), true)
      assert.equal(canTransitionAgentRun(status, 'cancelled'), true)
      assert.equal(canTransitionAgentRun(status, 'completed'), false)
      for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
        assert.equal(canTransitionAgentRun(terminal, status), false)
      }
    }
    assert.equal(canTransitionAgentRun('running', 'completed'), true)
    assert.equal(canTransitionAgentRun('completed', 'running'), false)
    assert.equal(canTransitionAgentRun('cancelled', 'completed'), false)
    assert.equal(canTransitionAgentRun('queued', 'completed'), false)
  })

  it('treats all canonical nonterminal statuses as active', () => {
    assert.equal(isActiveAgentRunStatus('queued'), true)
    assert.equal(isActiveAgentRunStatus('running'), true)
    assert.equal(isActiveAgentRunStatus('waiting_for_approval'), true)
    assert.equal(isActiveAgentRunStatus('waiting_for_input'), true)
    assert.equal(isActiveAgentRunStatus('waiting_for_children'), true)
    assert.equal(isTerminalAgentRunStatus('failed'), true)
    assert.equal(isTerminalAgentRunStatus('cancelled'), true)
    assert.equal(isTerminalAgentRunStatus('completed'), true)
  })
})
