import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxCreateRequest, SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import type { AgentEnvironment, AgentSandboxLease } from '@overlay/workspace-contracts'
import { CloudAgentMachineService } from './CloudAgentMachineService'
import { CLOUD_AGENT_WORKSPACE, cloudAgentConnectCommand, cloudAgentStopHostCommand } from './cloud-agent-machine'

function fakeMachine(status: 'running' | 'stopped' = 'running') {
  const commands: string[] = []
  const calls: string[] = []
  const machine = {
    reference: 'bx_agent',
    status: async () => status,
    resume: async () => { calls.push('resume') },
    stop: async () => { calls.push('stop') },
    delete: async () => { calls.push('delete') },
    runCommand: async (request: { args?: string[] }) => {
      commands.push(request.args?.[1] ?? '')
      return { wait: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }
    },
  } as unknown as SandboxInstance
  return { machine, commands, calls }
}

function fakeRuntime(machine: SandboxInstance) {
  const created: SandboxCreateRequest[] = []
  const runtime = {
    provider: 'box',
    capabilities: {} as never,
    create: async (request: SandboxCreateRequest) => { created.push(request); return machine },
    reconnect: async () => machine,
    restore: async () => machine,
    deleteSnapshot: async () => undefined,
  } as SandboxRuntime
  return { runtime, created }
}

const environment = (overrides: Partial<AgentEnvironment> = {}): AgentEnvironment => ({
  id: 'env-1', workspaceId: 'ws', kind: 'overlay_cloud', name: 'overlay-cloud-abcdef12', status: 'pending',
  capabilities: {}, createdAt: 0, updatedAt: 0, ...overrides,
})

function deps(machine: SandboxInstance, options: { enrolled?: boolean; lease?: AgentSandboxLease | null; env?: AgentEnvironment; bound?: boolean } = {}) {
  const log: Array<[string, unknown]> = []
  const phases: Array<{ phase: string; error?: string }> = []
  let removed = false
  const { runtime, created } = fakeRuntime(machine)
  const service = new CloudAgentMachineService({
    audit: { record: async () => undefined } as never,
    image: 'overlay-agent-v2',
    provisions: {
      get: async () => null,
      begin: async () => ({ started: true, phase: 'queued' }),
      setPhase: async (args: { phase: string; error?: string }) => { phases.push({ phase: args.phase, ...(args.error ? { error: args.error } : {}) }) },
      remove: async () => { removed = true },
    } as never,
    runtime,
    sleep: async () => undefined,
    now: () => 1_000,
    controlPlane: {
      createEnrollmentSession: async () => ({ code: 'one-time-code', expiresAt: 0, enrollmentSessionId: 'abcdef12-0000' }),
      approveEnvironment: async (args: unknown) => { log.push(['approve', args]); return {} as never },
      upsertBinding: async (args: unknown) => { log.push(['bind', args]); return { id: 'binding-1' } as never },
      revokeEnvironment: async (args: unknown) => { log.push(['revoke', args]) },
    },
    repository: {
      listEnvironments: async () => (options.enrolled === false ? [] : [environment()]),
      getEnvironment: async () => options.env ?? environment({ status: 'online', lastSeenAt: 999 }),
      createSandboxLease: async (input: unknown) => { log.push(['lease', input]); return { id: 'lease-1', status: 'running' } as never },
      getActiveSandboxLease: async () => (options.lease === undefined
        ? { id: 'lease-1', status: 'running', provider: 'box', providerReference: 'bx_agent' } as AgentSandboxLease
        : options.lease),
      patchSandboxLeaseUsage: async (args: unknown) => { log.push(['patch', args]); return null },
      listBindings: async () => (options.bound === false ? [] : [{
        id: 'binding-1', workspaceId: 'ws', agentId: 'agent-1', environmentId: 'env-1', adapterId: 'claude-code', enabled: true,
        adapterConfig: { providerAccountId: 'account-1', providerAccountOwnerUserId: 'user' },
      } as never]),
    },
  })
  return { service, log, created, phases, wasRemoved: () => removed }
}

const provisionArgs = {
  actorUserId: 'user', workspaceId: 'ws', agentId: 'agent-1', adapterId: 'claude-code' as const,
  providerAccountId: 'account-1', size: 'default' as const, serverUrl: 'https://www.getoverlay.io',
}

test('provision boots the image, redeems the code with acpx, approves the workspace root, leases, and binds', async () => {
  const { machine, commands } = fakeMachine()
  const { service, log, created } = deps(machine)
  const result = await service.provision(provisionArgs)

  assert.equal(created[0]?.snapshotId, 'overlay-agent-v2')
  assert.equal(created[0]?.hardTimeoutMs, 0)
  assert.deepEqual(created[0]?.resources, { vcpus: 4, memoryGiB: 8, diskGiB: 40 })
  assert.equal(commands[0], cloudAgentConnectCommand({
    enrollmentCode: 'one-time-code', serverUrl: 'https://www.getoverlay.io', name: 'overlay-cloud-abcdef12', adapterId: 'claude-code',
  }))
  assert.match(commands[0]!, /--kind overlay_cloud --engine acpx/)
  const approve = log.find(([kind]) => kind === 'approve')?.[1] as { filesystemGrant: unknown }
  assert.deepEqual(approve.filesystemGrant, { mode: 'selected_roots', roots: [CLOUD_AGENT_WORKSPACE] })
  const lease = log.find(([kind]) => kind === 'lease')?.[1] as { providerReference: string; usage: Record<string, unknown> }
  assert.equal(lease.providerReference, 'bx_agent')
  assert.equal(lease.usage.adapterId, 'claude-code')
  const bind = log.find(([kind]) => kind === 'bind')?.[1] as { agentId: string; workingDirectory: string }
  assert.equal(bind.agentId, 'agent-1')
  assert.equal(bind.workingDirectory, CLOUD_AGENT_WORKSPACE)
  assert.equal((bind as unknown as { providerAccountId: string }).providerAccountId, 'account-1')
  assert.equal(result.environment.id, 'env-1')
})

test('a machine that never enrolls is deleted', async () => {
  const { machine, calls } = fakeMachine()
  const { service } = deps(machine, { enrolled: false })
  await assert.rejects(service.provision(provisionArgs), /did not enroll/)
  assert.deepEqual(calls, ['delete'])
})

test('wake resumes a stopped machine and restarts its host', async () => {
  const { machine, commands, calls } = fakeMachine('stopped')
  const { service, log } = deps(machine, { env: environment({ status: 'offline' }) })
  assert.equal(await service.wake({ workspaceId: 'ws', environmentId: 'env-1' }), 'resumed')
  assert.deepEqual(calls, ['resume'])
  assert.equal(commands[0], cloudAgentStopHostCommand())
  assert.match(commands[1]!, /overlay-agent-host run --config/)
  assert.ok(log.some(([kind]) => kind === 'patch'))
})

test('wake leaves a running machine with a live host alone, and skips machines without a lease', async () => {
  const { machine, commands } = fakeMachine('running')
  assert.equal(await deps(machine).service.wake({ workspaceId: 'ws', environmentId: 'env-1' }), 'running')
  assert.deepEqual(commands, [])
  assert.equal(await deps(machine, { lease: null }).service.wake({ workspaceId: 'ws', environmentId: 'env-1' }), 'unavailable')
})

test('provision records each startup phase and a safe message when it fails', async () => {
  const { machine } = fakeMachine()
  const ok = deps(machine)
  await ok.service.provision(provisionArgs)
  assert.deepEqual(ok.phases.map((entry) => entry.phase), ['allocating', 'booting', 'connecting', 'ready'])

  const broken = deps(fakeMachine().machine, { enrolled: false })
  await assert.rejects(broken.service.provision(provisionArgs))
  assert.equal(broken.phases.at(-1)?.phase, 'failed')
  assert.ok(broken.phases.at(-1)?.error)
  assert.doesNotMatch(String(broken.phases.at(-1)?.error), /stack|bx_agent|one-time-code/)
})

test('pause stops the machine; restart replaces the host process', async () => {
  const paused = fakeMachine()
  await deps(paused.machine).service.control({ workspaceId: 'ws', agentId: 'agent-1', action: 'pause' })
  assert.deepEqual(paused.calls, ['stop'])

  const restarted = fakeMachine('stopped')
  await deps(restarted.machine).service.control({ workspaceId: 'ws', agentId: 'agent-1', action: 'restart' })
  assert.deepEqual(restarted.calls, ['resume'])
  assert.equal(restarted.commands[0], cloudAgentStopHostCommand())
  assert.equal(restarted.commands.length, 2)

  await assert.rejects(
    deps(fakeMachine().machine, { bound: false }).service.control({ workspaceId: 'ws', agentId: 'agent-1', action: 'pause' }),
    /no Overlay Cloud machine/,
  )
})

test('status reports a running agent, and a stopped machine as paused', async () => {
  const running = await deps(fakeMachine().machine).service.status({ workspaceId: 'ws', agentId: 'agent-1' })
  assert.equal(running.state, 'ready')
  const stopped = await deps(fakeMachine('stopped').machine).service.status({ workspaceId: 'ws', agentId: 'agent-1' })
  assert.equal(stopped.state, 'paused')
})

test('teardown revokes the environment, deletes the machine, and clears the provision record', async () => {
  const { machine, calls } = fakeMachine()
  const { service, log, wasRemoved } = deps(machine)
  await service.teardown({ actorUserId: 'user', workspaceId: 'ws', agentId: 'agent-1' })
  assert.ok(log.some(([name]) => name === 'revoke'))
  assert.deepEqual(calls, ['delete'])
  assert.equal(wasRemoved(), true)
})
