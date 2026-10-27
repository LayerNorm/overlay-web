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
  options: { externalAgent?: boolean; remoteTarget?: boolean; harness?: string } = {},
): WorkspaceAgentInvocation {
  return {
    agentId,
    agentName: agentId,
    agentPrincipalId: `principal-${agentId}`,
    invocationNonce: `nonce-${agentId}`,
    modelId: options.externalAgent ? 'byo/codex' : 'overlay/default',
    ...(options.harness ? { harness: options.harness } : {}),
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
  options: { nativeEnabled?: boolean; resumed?: boolean; nativeStartFails?: boolean } = {},
) {
  const nativeStarts: string[] = []
  const remoteStarts: string[] = []
  const failures: string[] = []
  const turnInputs: Array<Record<string, unknown>> = []
  const legacyStarts: string[] = []
  const harnessStarts: string[] = []
  const collaboration = {
    async enqueueMemoryExtraction() {},
    async startAgentTurn(input: Record<string, unknown> & { agentId: string }) {
      nativeStarts.push(input.agentId)
      turnInputs.push(input)
      return { resumed: options.resumed ?? true, runId: 'run-1', messageId: 'turn-message-1' }
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
    startWorkflow: async (_workflow, workflowArgs) => { legacyStarts.push(workflowArgs[0].runId) },
    startNative: async (input) => {
      harnessStarts.push(input.runId)
      if (options.nativeStartFails) throw new Error('native start failed')
    },
    nativeHarnessEnabled: () => options.nativeEnabled ?? false,
  }
  return {
    run: () => startWorkspaceAgentTurns(args, dependencies),
    nativeStarts,
    remoteStarts,
    failures,
    turnInputs,
    legacyStarts,
    harnessStarts,
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

test('flag-off overlay agents use the unchanged legacy dispatcher without native row markers', async () => {
  const f = fixture(
    [invocation('native', { harness: 'overlay' })],
    async () => {},
    { resumed: false, nativeEnabled: false },
  )
  await f.run()
  assert.equal(f.turnInputs.length, 1)
  assert.equal(Object.hasOwn(f.turnInputs[0]!, 'executionEngine'), false)
  assert.equal(Object.hasOwn(f.turnInputs[0]!, 'initiatorPrincipalId'), false)
  assert.deepEqual(f.legacyStarts, ['run-1'])
  assert.deepEqual(f.harnessStarts, [])
})

test('the default-off flag selects native Harness only for an overlay agent and marks its delivery row', async () => {
  const f = fixture(
    [invocation('native', { harness: 'overlay' })],
    async () => {},
    { resumed: false, nativeEnabled: true },
  )
  await f.run()
  assert.equal(f.turnInputs[0]!.executionEngine, 'overlay_harness')
  assert.equal(f.turnInputs[0]!.initiatorPrincipalId, args.initiatorPrincipalId)
  assert.deepEqual(f.harnessStarts, ['run-1'])
  assert.deepEqual(f.legacyStarts, [])
})

test('remote and external invocations stay outside the native flag and resumed turns do not start again', async () => {
  const remote = fixture(
    [invocation('remote', { harness: 'overlay', remoteTarget: true }), invocation('external', { externalAgent: true })],
    async () => {},
    { nativeEnabled: true, resumed: false },
  )
  await remote.run()
  assert.deepEqual(remote.remoteStarts, ['remote'])
  assert.deepEqual(remote.harnessStarts, [])
  assert.deepEqual(remote.turnInputs, [])

  const resumed = fixture(
    [invocation('native', { harness: 'overlay' })],
    async () => {},
    { nativeEnabled: true, resumed: true },
  )
  await resumed.run()
  assert.deepEqual(resumed.harnessStarts, [])
  assert.deepEqual(resumed.legacyStarts, [])
})

test('a native workflow start failure uses the existing failure-message path', async () => {
  const f = fixture(
    [invocation('native', { harness: 'overlay' })],
    async () => {},
    { nativeEnabled: true, resumed: false, nativeStartFails: true },
  )
  await f.run()
  assert.deepEqual(f.failures, ['principal-native'])
})
