import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startWorkspaceAgentTurns,
  type WorkspaceAgentTurnDispatcherDependencies,
} from './start-agent-turns'
import {
  WorkspaceAgentInvocationError,
  type WorkspaceAgentInvocation,
} from './workspace-agent-invocation'

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

function invocation(
  agentId: string,
  options: { externalAgent?: boolean; remoteTarget?: boolean } = {},
): WorkspaceAgentInvocation {
  return {
    agentId,
    agentName: agentId,
    agentPrincipalId: `principal-${agentId}`,
    invocationNonce: `nonce-${agentId}`,
    modelId: options.externalAgent ? 'byo/codex' : 'overlay/default',
    externalAgent: options.externalAgent ?? false,
    turnId: `turn-${agentId}`,
    ...(options.remoteTarget ? {
      remoteTarget: {
        adapterId: 'codex',
        bindingId: 'binding-1',
        environmentId: 'environment-1',
        environmentName: 'Host',
        environmentKind: 'local',
        usesProviderAccount: true,
        modelUsageBilling: 'byok',
        online: true,
        protocolAdapter: 'acp',
        workingDirectory: '/workspace',
      } as NonNullable<WorkspaceAgentInvocation['remoteTarget']>,
    } : {}),
  }
}

function fixture(
  invocations: WorkspaceAgentInvocation[],
  startRemote: NonNullable<WorkspaceAgentTurnDispatcherDependencies['startRemote']>,
) {
  const nativeStarts: string[] = []
  const remoteStarts: string[] = []
  const failures: string[] = []
  const collaboration = {
    async enqueueMemoryExtraction() {},
    async startAgentTurn(input: { agentId: string }) {
      nativeStarts.push(input.agentId)
      return { resumed: true, runId: 'run-1', messageId: 'turn-message-1' }
    },
    async startAgentMessage(input: { authorPrincipalId: string }) {
      failures.push(input.authorPrincipalId)
      return 'failure-message'
    },
    async failAgentMessage() {},
  }
  const dependencies: WorkspaceAgentTurnDispatcherDependencies = {
    getCollaboration: () => collaboration as unknown as ReturnType<
      NonNullable<WorkspaceAgentTurnDispatcherDependencies['getCollaboration']>
    >,
    resolveInvocations: async () => invocations,
    startRemote: async (input) => {
      remoteStarts.push(input.invocation.agentId)
      return await startRemote(input)
    },
  }
  return {
    run: () => startWorkspaceAgentTurns(args, dependencies),
    nativeStarts,
    remoteStarts,
    failures,
  }
}

test('a disabled external peer does not prevent a native peer from starting', async () => {
  const f = fixture(
    [invocation('native'), invocation('external', { externalAgent: true, remoteTarget: true })],
    async () => {
      throw new WorkspaceAgentInvocationError('not_entitled')
    },
  )

  await f.run()

  assert.deepEqual(f.nativeStarts, ['native'])
  assert.deepEqual(f.remoteStarts, ['external'])
  assert.deepEqual(f.failures, ['principal-external'])
})

test('an external identity without a target never falls back to native execution', async () => {
  const f = fixture(
    [invocation('external', { externalAgent: true })],
    async () => {
      throw new Error('remote dispatcher should not be reached')
    },
  )

  await f.run()

  assert.deepEqual(f.nativeStarts, [])
  assert.deepEqual(f.remoteStarts, [])
  assert.deepEqual(f.failures, ['principal-external'])
})

test('an enabled external peer with a target uses remote dispatch', async () => {
  const f = fixture(
    [invocation('external', { externalAgent: true, remoteTarget: true })],
    async () => {},
  )

  await f.run()

  assert.deepEqual(f.nativeStarts, [])
  assert.deepEqual(f.remoteStarts, ['external'])
  assert.deepEqual(f.failures, [])
})
