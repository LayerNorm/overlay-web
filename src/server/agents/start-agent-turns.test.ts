import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startWorkspaceAgentTurns,
  type WorkspaceAgentTurnDispatcherDependencies,
} from './start-agent-turns'
import type { WorkspaceAgentInvocation } from './workspace-agent-invocation'
import { WorkspaceExecutionError } from '@/server/billing/WorkspaceExecutionPolicy'

const args = {
  actorUserId: 'user-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  mentionedPrincipalIds: ['native', 'external'],
  initiatorPrincipalId: 'person-1',
  prompt: 'Please help',
  memoryEnabled: false,
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
}

function invocation(agentId: string): WorkspaceAgentInvocation {
  return {
    agentId,
    agentName: agentId,
    agentPrincipalId: `principal-${agentId}`,
    invocationNonce: `nonce-${agentId}`,
    modelId: 'overlay/default',
    turnId: `turn-${agentId}`,
  }
}

function fixture(
  invocations: WorkspaceAgentInvocation[],
  options: { resumed?: boolean; nativeStartFails?: boolean; admissionFails?: boolean } = {},
) {
  const nativeStarts: string[] = []
  const failures: string[] = []
  const failureRows: Array<{ content: string; failure?: { code: string; message: string; retryable: boolean } }> = []
  const turnInputs: Array<Record<string, unknown>> = []
  const harnessStarts: string[] = []
  const admissions: boolean[] = []
  const collaboration = {
    async enqueueMemoryExtraction() {},
    async startAgentTurn(input: Record<string, unknown> & { agentId: string }) {
      nativeStarts.push(input.agentId)
      turnInputs.push(input)
      return { resumed: options.resumed ?? true, runId: 'run-1', messageId: 'turn-message-1' }
    },
    async recordAgentStartFailure(input: {
      authorPrincipalId: string
      content: string
      failure?: { code: string; message: string; retryable: boolean }
    }) {
      failures.push(input.authorPrincipalId)
      failureRows.push({ content: input.content, failure: input.failure })
      return 'failure-message'
    },
    async failAgentMessage() {},
  }
  const dependencies: WorkspaceAgentTurnDispatcherDependencies = {
    requireExecution: async (input) => {
      admissions.push(input.checkBudget ?? true)
      if (options.admissionFails) {
        throw new WorkspaceExecutionError({ state: 'subscription_required', canExecute: false }, true)
      }
      return { billingEnabled: false } as never
    },
    getCollaboration: () => collaboration as unknown as ReturnType<
      NonNullable<WorkspaceAgentTurnDispatcherDependencies['getCollaboration']>
    >,
    resolveInvocations: async () => invocations,
    startNative: async (input) => {
      harnessStarts.push(input.runId)
      if (options.nativeStartFails) throw new Error('native start failed')
    },
  }
  return {
    run: (strictErrors = false) => startWorkspaceAgentTurns({ ...args, ...(strictErrors ? { strictErrors } : {}) }, dependencies),
    nativeStarts,
    failures,
    failureRows,
    turnInputs,
    harnessStarts,
    admissions,
  }
}

test('agent starts require workspace admission before opening a durable turn', async () => {
  const f = fixture([invocation('native')], { admissionFails: true })

  await f.run()

  assert.deepEqual(f.admissions, [false])
  assert.deepEqual(f.nativeStarts, [])
  assert.deepEqual(f.harnessStarts, [])
  assert.deepEqual(f.failures, ['principal-native'])
})

test('an unpaid workspace tells the user why the agent did not start', async () => {
  const f = fixture([invocation('native')], { admissionFails: true })

  await f.run()

  assert.equal(f.failureRows.length, 1)
  assert.match(f.failureRows[0]!.content, /doesn't have a paid plan\. Open Workspace Billing/)
  assert.deepEqual(f.failureRows[0]!.failure, { code: 'subscription_required', message: 'Paid plan required.', retryable: false })
})

test('overlay agents always use native Harness and mark its delivery row', async () => {
  const f = fixture([invocation('native')], { resumed: false },
  )
  await f.run()
  assert.equal(f.turnInputs[0]!.executionEngine, 'overlay_harness')
  assert.equal(f.turnInputs[0]!.initiatorPrincipalId, args.initiatorPrincipalId)
  assert.deepEqual(f.harnessStarts, ['run-1'])
})

test('every agent, including one set up for a removed third-party harness, starts a native turn; a resumed turn does not start again', async () => {
  const fresh = fixture([invocation('one'), invocation('two')], { resumed: false })
  await fresh.run()
  assert.deepEqual(fresh.nativeStarts, ['one', 'two'])
  assert.deepEqual(fresh.harnessStarts, ['run-1', 'run-1'])
  assert.deepEqual(fresh.failures, [])

  const resumed = fixture([invocation('native')], { resumed: true })
  await resumed.run()
  assert.deepEqual(resumed.harnessStarts, [])
})
test('a native workflow start failure uses the existing failure-message path', async () => {
  const f = fixture([invocation('native')], { resumed: false, nativeStartFails: true },
  )
  await f.run()
  assert.deepEqual(f.failures, ['principal-native'])
})

test('strict assignment dispatch propagates a start failure after persisting the existing failure message', async () => {
  const f = fixture([invocation('native')], { resumed: false, nativeStartFails: true },
  )
  await assert.rejects(f.run(true), /native start failed/)
  assert.deepEqual(f.failures, ['principal-native'])
})
