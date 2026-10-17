import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxCreateRequest, SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import type { AgentEnvironment, AgentSandboxLease } from '@overlay/workspace-contracts'
import { CloudAgentMachineService } from './CloudAgentMachineService'
import { CLOUD_AGENT_WORKSPACE, cloudAgentConnectCommand, cloudAgentRunCommand, cloudAgentStopHostCommand } from './cloud-agent-machine'
import { CLOUD_AGENT_PREVIEW_ACCESS_PATH } from './cloud-agent-preview-access'

function fakeMachine(status: 'running' | 'stopped' = 'running', files: Record<string, string> = {}) {
  const written: string[] = []
  const commands: string[] = []
  const calls: string[] = []
  const machine = {
    reference: 'bx_agent',
    status: async () => status,
    resume: async () => { calls.push('resume') },
    stop: async () => { calls.push('stop') },
    delete: async () => { calls.push('delete') },
    readFile: async (path: string) => (path in files ? new TextEncoder().encode(files[path]) : null),
    writeFiles: async (batch: Array<{ path: string }>) => { written.push(...batch.map((file) => file.path)) },
    runCommand: async (request: { args?: string[] }) => {
      commands.push(request.args?.[1] ?? '')
      return { wait: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }
    },
  } as unknown as SandboxInstance
  return { machine, commands, calls, written }
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

function deps(machine: SandboxInstance, options: { enrolled?: boolean; lease?: AgentSandboxLease | null; env?: AgentEnvironment; bound?: boolean; activeExecution?: boolean } = {}) {
  const log: Array<[string, unknown]> = []
  const phases: Array<{ phase: string; error?: string }> = []
  let removed = false
  const { runtime, created } = fakeRuntime(machine)
  const service = new CloudAgentMachineService({
    audit: { record: async () => undefined } as never,
    image: 'overlay-agent-v5',
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
      sweepRemoteRuns: async (args?: unknown) => { log.push(['sweep', args]); return {} as never },
    },
    repository: {
      environmentHasActiveExecution: async () => options.activeExecution === true,
      listEnvironments: async () => (options.enrolled === false ? [] : [environment()]),
      getEnvironment: async () => options.env ?? environment({ status: 'online', lastSeenAt: 999 }),
      createSandboxLease: async (input: unknown) => { log.push(['lease', input]); return { id: 'lease-1', status: 'running' } as never },
      getActiveSandboxLease: async (args) => {
        log.push(['lease-read', args])
        return options.lease === undefined
          ? { id: 'lease-1', status: 'running', provider: 'box', providerReference: 'bx_agent' } as AgentSandboxLease
          : options.lease
      },
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

  assert.equal(created[0]?.snapshotId, 'overlay-agent-v5')
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

test('Preview provision, resume and explicit restart prepare private access before launching the host, without putting its secret in commands', async () => {
  const preview = {VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'https://pr-247.preview.getoverlay.io',
    VERCEL_GIT_PULL_REQUEST_ID: '247', VERCEL_AUTOMATION_BYPASS_SECRET: 'preview-private-fixture-secret'}
  const previous = new Map(Object.keys(preview).map(key => [key, process.env[key]]))
  Object.assign(process.env, preview)
  try {
    for (const mode of ['provision', 'resume', 'legacy-resume', 'restart', 'legacy-restart', 'already-online']) {
      const resuming = mode === 'resume' || mode === 'legacy-resume'
      const f = fakeMachine(resuming ? 'stopped' : 'running'), order: string[] = []
      const write = f.machine.writeFiles.bind(f.machine), run = f.machine.runCommand.bind(f.machine)
      f.machine.writeFiles = async files => {order.push('private-access'); assert.equal(files[0].mode, 0o600); await write(files)}
      f.machine.runCommand = async request => {
        order.push(request.args?.[1]?.startsWith('mkdir -p -m 700') ? 'private-directory' : 'command')
        return run(request)
      }
      const lease: AgentSandboxLease = {id: 'lease-1', workspaceId: 'ws', environmentId: 'env-1', status: 'running',
        provider: 'box', providerReference: 'bx_agent', reservedUntil: 10000, cleanupAttempts: 0, createdAt: 0, updatedAt: 0,
        usage: mode === 'resume' || mode === 'restart' ? {previewHostingAccessVersion: 1} : {}}
      const {service, log} = deps(f.machine, mode === 'provision' || mode === 'already-online' ? {} : {env: environment({status: resuming ? 'offline' : 'online'}), lease})
      if (mode === 'provision') await service.provision({...provisionArgs, serverUrl: preview.NEXT_PUBLIC_APP_URL})
      else if (mode === 'restart' || mode === 'legacy-restart') await service.control({workspaceId: 'ws', agentId: 'agent-1', action: 'restart'})
      else await service.wake({workspaceId: 'ws', environmentId: 'env-1'})
      if (mode === 'already-online') {assert.deepEqual(order, []); continue}
      if (mode === 'legacy-resume' || mode === 'legacy-restart') {
        assert.deepEqual(f.written, [])
        assert.ok(f.commands.every(command => !command.includes('--hosting-auth-file')))
        continue
      }
      if (mode === 'provision') {
        const created = log.find(([kind]) => kind === 'lease')?.[1]
        assert.partialDeepStrictEqual(created, {usage: {previewHostingAccessVersion: 1}})
      }
      assert.deepEqual(order.slice(0, 2), ['private-directory', 'private-access'])
      assert.deepEqual(f.written, [CLOUD_AGENT_PREVIEW_ACCESS_PATH])
      assert.ok(f.commands.some(command => command.includes(`--hosting-auth-file '${CLOUD_AGENT_PREVIEW_ACCESS_PATH}'`)))
      assert.ok(f.commands.every(command => !command.includes(preview.VERCEL_AUTOMATION_BYPASS_SECRET)))
    }
  } finally {for (const [key, value] of previous) {if (value === undefined) delete process.env[key]; else process.env[key] = value}}
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

test('recovery records the exact stopped machine before resume and starts only its managed host', async () => {
  const {machine, commands, calls} = fakeMachine('stopped')
  const {service, log} = deps(machine, {activeExecution: true})
  const result = await service.resumeStoppedExecution({workspaceId: 'ws', environmentId: 'env-1', authorize: async proof => {
    assert.deepEqual(proof, {leaseId: 'lease-1', providerReference: 'bx_agent', observedAt: 1000})
    assert.deepEqual(calls, [])
    assert.deepEqual(commands, [])
    return true
  }})
  assert.equal(result, 'resumed')
  assert.deepEqual(calls, ['resume'])
  assert.equal(commands[0], cloudAgentStopHostCommand())
  assert.match(commands[1]!, /overlay-agent-host run --config/)
  assert.ok(log.some(([kind]) => kind === 'patch'))
  for (const [, scope] of log.filter(([kind]) => kind === 'lease-read'))
    assert.deepEqual(scope, {workspaceId: 'ws', environmentId: 'env-1'}, 'only serializable machine scope crosses the repository boundary')
})

test('recovery never stops live work and never resumes a rejected authorization', async () => {
  for (const status of ['running', 'stopped'] as const) {
    const {machine, commands, calls} = fakeMachine(status)
    const {service} = deps(machine, {activeExecution: true})
    let requested = false
    assert.equal(await service.resumeStoppedExecution({workspaceId: 'ws', environmentId: 'env-1', authorize: async () => {
      requested = true; return false
    }}), 'unavailable')
    assert.equal(requested, status === 'stopped')
    assert.deepEqual(calls, [])
    assert.deepEqual(commands, [])
  }
})

test('recovery refuses a lease replacement before or during provider resume', async () => {
  const lease: AgentSandboxLease = {id: 'lease-1', workspaceId: 'ws', environmentId: 'env-1', provider: 'box',
    providerReference: 'bx_agent', status: 'running', reservedUntil: 10000, cleanupAttempts: 0, createdAt: 0, updatedAt: 0}
  for (const when of ['authorize', 'resume']) {
    const {machine, commands, calls} = fakeMachine('stopped')
    const options = {lease}
    const {service} = deps(machine, options)
    const replace = () => {options.lease = {...lease, id: 'replacement', providerReference: 'bx_other'}}
    if (when === 'resume') machine.resume = async () => {calls.push('resume'); replace()}
    assert.equal(await service.resumeStoppedExecution({workspaceId: 'ws', environmentId: 'env-1', authorize: async () => {
      if (when === 'authorize') replace()
      return true
    }}), 'unavailable')
    assert.deepEqual(calls, when === 'resume' ? ['resume'] : [])
    assert.deepEqual(commands, [])
  }
})

test('recovery leaves a concurrently resumed machine alone and rejects providers without disk-only isolation', async () => {
  const {machine, calls, commands} = fakeMachine('stopped')
  const {service} = deps(machine)
  assert.equal(await service.resumeStoppedExecution({workspaceId: 'ws', environmentId: 'env-1', authorize: async () => {
    machine.status = async () => 'running'
    return true
  }}), 'unavailable')
  assert.deepEqual(calls, [])
  assert.deepEqual(commands, [])
  const unsupported = deps(machine, {lease: {id: 'lease-1', workspaceId: 'ws', environmentId: 'env-1', provider: 'e2b',
    providerReference: 'other', status: 'running', reservedUntil: 10000, cleanupAttempts: 0, createdAt: 0, updatedAt: 0}})
  assert.equal(await unsupported.service.resumeStoppedExecution({workspaceId: 'ws', environmentId: 'env-1', authorize: async () => {
    assert.fail('Unsupported provider must not request a stop receipt')
  }}), 'unavailable')
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

test('pausing or restarting first fails the runs the machine was in the middle of', async () => {
  for (const action of ['pause', 'restart'] as const) {
    const { machine } = fakeMachine()
    const { service, log } = deps(machine)
    await service.control({ workspaceId: 'ws', agentId: 'agent-1', action })
    assert.deepEqual(log.filter(([name]) => name === 'sweep'), [['sweep', { abandonEnvironmentId: 'env-1' }]])
  }
  const { machine } = fakeMachine()
  const resumed = deps(machine)
  await resumed.service.control({ workspaceId: 'ws', agentId: 'agent-1', action: 'resume' })
  assert.equal(resumed.log.filter(([name]) => name === 'sweep').length, 0)
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

test('applying a profile removes what the earlier version wrote, prunes the folders it empties, and records what it owns', async () => {
  const previous = JSON.stringify({ version: 1, harness: 'claude-code', files: ['skills/old/SKILL.md', 'commands/old.md', 'CLAUDE.md'], mcpServers: [] })
  const { machine, commands, written } = fakeMachine('running', { '/home/user/.overlay/profile-managed.json': previous })
  const { service } = deps(machine, { env: environment({ status: 'online', lastSeenAt: 999 }) })
  await service.applyProfile({
    workspaceId: 'ws', agentId: 'agent-1', hooksEnabled: false, version: 2,
    bundle: { version: 1, harness: 'claude-code', mcpServers: {}, hooks: [], secrets: [], files: [{ path: 'CLAUDE.md', content: 'new' }] },
  })
  const removal = commands.find((command) => command.startsWith('rm -f'))
  assert.ok(removal?.includes("'/home/user/.claude/skills/old/SKILL.md'") && removal.includes("'/home/user/.claude/commands/old.md'"))
  assert.ok(!removal?.includes("'/home/user/.claude/CLAUDE.md'"), 'a file the new version still has is kept')
  const prune = commands.find((command) => command.startsWith('rmdir'))
  assert.ok(prune?.includes("'/home/user/.claude/skills/old'") && prune.includes("'/home/user/.claude/commands'"))
  assert.ok(!prune?.includes("'/home/user/.claude'"), 'the harness folder itself is never removed')
  assert.ok(written.includes('/home/user/.claude/CLAUDE.md') && written.includes('/home/user/.overlay/profile-managed.json'))
})

test('files for a run go onto the running machine under the home folder, and nowhere else', async () => {
  const { machine, commands, written } = fakeMachine('running')
  const { service } = deps(machine)
  await service.writeFiles({ workspaceId: 'ws', environmentId: 'env-1', files: [{ path: '/home/user/.codex/auth.json', contents: '{}', mode: 0o600 }] })
  assert.deepEqual(written, ['/home/user/.codex/auth.json'])
  assert.ok(commands.some((command) => command.startsWith('mkdir -p') && command.includes("'/home/user/.codex'")))
  await assert.rejects(service.writeFiles({ workspaceId: 'ws', environmentId: 'env-1', files: [{ path: '/etc/passwd', contents: 'x' }] }), /not allowed/)
  await assert.rejects(service.writeFiles({ workspaceId: 'ws', environmentId: 'env-1', files: [{ path: '/home/user/../etc/x', contents: 'x' }] }), /not allowed/)
  const gone = deps(fakeMachine('running').machine, { lease: null })
  await assert.rejects(gone.service.writeFiles({ workspaceId: 'ws', environmentId: 'env-1', files: [{ path: '/home/user/a', contents: 'x' }] }), /not available/)
})

test('an agent whose machine is gone shows as unavailable, and reviving clears its environment and provision record', async () => {
  const { machine } = fakeMachine()
  const { service, log, wasRemoved } = deps(machine, { lease: null })
  // The provision record says "ready" (a finished provision), but no lease or machine backs the agent any more.
  const status = await new (service.constructor as typeof CloudAgentMachineService)({
    ...(service as unknown as { dependencies: ConstructorParameters<typeof CloudAgentMachineService>[0] }).dependencies,
    provisions: { get: async () => ({ phase: 'ready', updatedAt: 1 }), begin: async () => ({ started: false, phase: 'ready' }), setPhase: async () => undefined, remove: async () => undefined } as never,
  }).status({ workspaceId: 'ws', agentId: 'agent-1' })
  assert.equal(status.state, 'unavailable')
  assert.equal(status.adapterId, 'claude-code')
  assert.equal(await service.reviveIfMachineGone({ actorUserId: 'user', workspaceId: 'ws', agentId: 'agent-1' }), true)
  assert.ok(log.some(([name]) => name === 'revoke'))
  assert.equal(wasRemoved(), true)
})

test('reviving never touches an agent whose machine exists', async () => {
  const { machine } = fakeMachine()
  const { service, log, wasRemoved } = deps(machine)
  assert.equal(await service.reviveIfMachineGone({ actorUserId: 'user', workspaceId: 'ws', agentId: 'agent-1' }), false)
  assert.equal(log.some(([name]) => name === 'revoke'), false)
  assert.equal(wasRemoved(), false)
})

test('wake never replaces a stale bridge while an observed execution may still own external writes', async () => {
  const { machine, commands } = fakeMachine('running')
  const { service } = deps(machine, { activeExecution: true, env: environment({ status: 'offline', lastSeenAt: 0 }) })
  assert.equal(await service.wake({ workspaceId: 'ws', environmentId: 'env-1' }), 'unavailable')
  assert.equal(commands.length, 0)
})

test('unreachable execution is confirmed stopped only after provider readback, with no resume', async () => {
  const { machine, calls } = fakeMachine('running')
  let stopped = false
  machine.stop = async () => { stopped = true; calls.push('stop') }
  machine.status = async () => stopped ? 'stopped' : 'running'
  const { service } = deps(machine)
  assert.equal(await service.stopExecution({ workspaceId: 'ws', environmentId: 'env-1' }), true)
  assert.equal(await machine.status(), 'stopped')
  assert.ok(!calls.includes('resume'))
})

test('a successful provider stop request without stopped-state proof is not confirmation', async () => {
  const { machine } = fakeMachine('running')
  assert.equal(await deps(machine).service.stopExecution({ workspaceId: 'ws', environmentId: 'env-1' }), false)
})

test('managed startup propagates lifecycle v2 only after explicit enablement', () => {
  const input = { enrollmentCode: 'fixture-code', serverUrl: 'https://preview.example.test', name: 'fixture', adapterId: 'codex' as const }
  for (const value of [undefined, '1', '2']) {
    const env = { OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION: value }
    assert.equal(cloudAgentConnectCommand(input, env).includes('OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION=2'), value === '2')
    assert.equal(cloudAgentRunCommand(env).includes('OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION=2'), value === '2')
  }
})
