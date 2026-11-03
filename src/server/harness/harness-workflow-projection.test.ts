import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { describe, expect, test } from 'vitest'
import {
  projectCurrentHarnessOwner,
} from '../workflows/harness-workflow-projection'

function makeSnapshot(status: 'running' | 'waiting_for_resources' | 'waiting_for_authorization') {
  return {
    ...createHarnessSnapshot({
      runId: 'run-1',
      goal: 'Test',
      constraints: [],
      policy: {
        actorUserId: 'user-1',
        allowedToolIds: [],
        requiresPlan: false,
        maxCostMicros: 0,
        deadlineAt: Date.now() + 60_000,
        maxDepth: 1,
        maxParallelChildren: 1,
        executionPolicyVersion: 2,
        spendingMode: 'workspace',
        workspaceId: 'workspace-1',
      },
    }, Date.now()),
    workflowRunId: 'workflow-1',
    executionGeneration: 2,
    status,
  }
}

const access = { workflowRunId: 'workflow-1', executionGeneration: 2 }

describe('projectCurrentHarnessOwner', () => {
  test('keeps same-owner funding failures in the workflow catch path', () => {
    const state = makeSnapshot('waiting_for_resources')

    expect(projectCurrentHarnessOwner(state, access)).toBeNull()
    expect(projectCurrentHarnessOwner(state, access, { includeFundingPause: true })).toEqual({
      runId: 'run-1',
      status: 'waiting_for_resources',
    })
  })

  test('projects same-owner authorization pauses in both paths', () => {
    expect(projectCurrentHarnessOwner(makeSnapshot('waiting_for_authorization'), access)).toEqual({
      runId: 'run-1',
      status: 'waiting_for_authorization',
    })
  })

  test('projects persisted state for an owner or generation mismatch', () => {
    const state = { ...makeSnapshot('waiting_for_resources'), executionGeneration: 3 }

    expect(projectCurrentHarnessOwner(state, access)).toEqual({
      runId: 'run-1',
      status: 'waiting_for_resources',
    })
  })
})
