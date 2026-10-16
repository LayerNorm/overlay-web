import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AgentHostCommand, DriveCredentialsRequest, EventBatch, FilesystemGrant, HostCapabilities } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapter, EmitAgentEvent, StartAdapterSessionInput } from './adapter.js'
import { AgentHostRuntime, type AgentHostRuntimeOptions } from './runtime.js'
import { SqliteHostStateStore } from './state.js'
import { ControlPlaneRequestError, type AgentControlPlaneClient } from './transport.js'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-drive-integration-'))
  const project = join(directory, 'project'), drive = join(project, 'dedicated-drive')
  await mkdir(drive, { recursive: true })
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  const order: string[] = [], events: EventBatch[] = [], starts: StartAdapterSessionInput[] = []
  const requests: Omit<DriveCredentialsRequest, 'protocolVersion'>[] = []
  let emit: EmitAgentEvent = async () => { throw Error('adapter not started') }, closes = 0
  let credentialError: Error | undefined
  const filesystem: FilesystemGrant = { mode: 'selected_roots', roots: [project] }
  const adapter: AgentAdapter = {
    capability: { id: 'fixture', displayName: 'Fixture', protocol: 'fake', supports: { prompt: true, approval: true, cancel: true, resume: true } },
    async discover() { return this.capability },
    async start(input, callback) {
      order.push('adapter'); starts.push(input); emit = callback
      return { remoteSessionId: 'native-session', async prompt() { order.push('prompt') },
        async approve() {}, async elicit() {}, async cancel() {}, async resume() {}, async stop() {} }
    },
  }
  const controlPlane: AgentControlPlaneClient = {
    async pollCommands() { return { commands: [] } }, async acknowledgeCommand() {},
    async uploadEvents(batch) { events.push(batch); return { protocolVersion: 1, accepted: true,
      acknowledgedSequence: batch.events[batch.events.length - 1].sourceSequence } },
    async refreshFilesystemGrant() { order.push('refresh'); return filesystem },
    async fetchDriveCredentials(request) {
      order.push('drive-credentials'); requests.push(request)
      return { protocolVersion: 1, scope: { kind: 'personal', workspaceId: 'workspace', ownerUserId: 'owner' },
        token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}`, expiresAt: Date.now() + 3600000 }
    },
    async fetchRunCredentials() {
      order.push('provider-credentials')
      if (credentialError) throw credentialError
      return { PROVIDER_TOKEN: 'memory-only' }
    },
  }
  const options: AgentHostRuntimeOptions = { environmentId: 'environment', workspaceId: 'workspace', filesystem,
    durableLifecycle: true, fetchRunCredentials: true, adapters: [adapter], state, controlPlane,
    drive: { stateDirectory: directory, apiUrl: 'https://preview.invalid/api/agent-drive', create: async input => {
      order.push('hydrate')
      assert.deepEqual(input.filesystem, filesystem)
      assert.equal(input.approvedWorkingDirectory, project)
      assert.equal(input.sessionId, 'internal-session')
      assert.deepEqual(input.execution, { attemptId: 'attempt', generation: 2 })
      await input.credentials()
      return { workingDirectory: drive, additionalDirectories: [],
        sync: async final => { order.push(final ? 'final-sync' : 'sync'); return [] },
        close: async () => { closes++ },
      }
    } },
  }
  const runtime = new AgentHostRuntime(options)
  const command: AgentHostCommand = { protocolVersion: 1, commandId: 'start', environmentId: 'environment',
    workspaceId: 'workspace', runId: 'run', sequence: 1, issuedAt: Date.now(), execution: { attemptId: 'attempt', generation: 2 },
    type: 'start', payload: { bindingId: 'binding', adapterId: 'fixture', workingDirectory: project, prompt: 'Write a report',
      sessionId: 'native-session', metadata: { runCredentials: true,
        overlayDrive: { version: 1, sessionId: 'internal-session', location: 'approved-root' } } },
  }
  return { runtime, command, order, events, starts, requests, options, drive, closes: () => closes,
    emit: (event: Parameters<EmitAgentEvent>[0]) => emit(event),
    failCredentials() { credentialError = new ControlPlaneRequestError(409, 'account_needs_reauth') },
    async cleanup() { runtime.stopBackgroundUploads(); await runtime.flushOutbox(); state.close(); await rm(directory, { recursive: true, force: true }) },
  }
}

test('runtime hydrates the fixed scope before provider start, then saves before terminal outbox delivery', async () => {
  const f = await fixture()
  try {
    await f.runtime.processCommand(f.command)
    assert.deepEqual(f.order.slice(0, 6), ['provider-credentials', 'refresh', 'hydrate', 'drive-credentials', 'adapter', 'prompt'])
    assert.equal(f.starts[0]?.workingDirectory, f.drive)
    assert.deepEqual(f.starts[0]?.additionalDirectories, [])
    assert.deepEqual(f.requests, [{ runId: 'run', sessionId: 'internal-session', execution: { attemptId: 'attempt', generation: 2 } }])
    await f.emit({ type: 'completed', payload: { usage: {} } })
    await f.runtime.flushOutbox()
    const events = f.events.flatMap(batch => batch.events)
    assert.deepEqual(events.slice(-3).map(event => event.type), ['drive_sync', 'drive_sync', 'completed'])
    assert.equal(f.closes(), 1)
    assert.equal(JSON.stringify(events).includes('memory-only'), false)
  } finally { await f.cleanup() }
})

test('unavailable provider credentials never acquire a drive lease or launch an adapter', async () => {
  const f = await fixture()
  try {
    f.failCredentials()
    await f.runtime.processCommand(f.command)
    assert.deepEqual(f.order, ['provider-credentials'])
    assert.equal(f.starts.length, 0)
    assert.equal(f.closes(), 0)
  } finally { await f.cleanup() }
})

test('a newly approved drive directory is prepared before resolving all physical grant roots', async () => {
  const f = await fixture()
  try {
    await rm(f.drive, { recursive: true })
    if (f.options.filesystem.mode !== 'selected_roots' || !f.options.drive?.create) throw Error('Missing fixture filesystem')
    f.options.filesystem.roots.push(f.drive)
    const create = f.options.drive.create
    f.options.drive.create = async input => { await mkdir(f.drive); return create(input) }
    await f.runtime.processCommand(f.command)
    assert.equal(f.starts[0]?.workingDirectory, f.drive)
    await f.emit({ type: 'completed', payload: { usage: {} } })
  } finally { await f.cleanup() }
})

test('drive metadata is refused on hosts without signed refresh support, before adapter start', async () => {
  const f = await fixture()
  try {
    f.options.controlPlane.refreshFilesystemGrant = undefined
    await assert.rejects(f.runtime.processCommand(f.command), /DRIVE_HOST_UPGRADE_REQUIRED/)
    assert.equal(f.starts.length, 0)
    assert.equal(f.order.includes('hydrate'), false)
  } finally { await f.cleanup() }
})

test('host heartbeats continue during slow hydration and concurrent attempts share one request', async context => {
  const f = await fixture()
  let releaseHydration: () => void = () => {}, releaseHeartbeat: () => void = () => {}, enteredHydration: () => void = () => {}
  const hydrationGate = new Promise<void>(resolve => { releaseHydration = resolve })
  const heartbeatGate = new Promise<void>(resolve => { releaseHeartbeat = resolve })
  const hydrating = new Promise<void>(resolve => { enteredHydration = resolve })
  const controller = new AbortController()
  let running: Promise<void> | undefined, heartbeats = 0
  try {
    context.mock.timers.enable({ apis: ['Date', 'setInterval'] })
    const create = f.options.drive?.create
    if (!create || !f.options.drive) throw Error('Missing fixture drive')
    f.options.drive.create = async input => { enteredHydration(); await hydrationGate; return create(input) }
    f.options.controlPlane.heartbeat = async () => { if (++heartbeats > 1) await heartbeatGate }
    f.options.controlPlane.pollCommands = async () => ({ commands: [f.command] })
    running = f.runtime.run(controller.signal)
    await hydrating
    assert.equal(heartbeats, 1)
    assert.equal(f.starts.length, 0)
    context.mock.timers.tick(30000)
    assert.equal(heartbeats, 2)
    context.mock.timers.tick(90000)
    assert.equal(heartbeats, 2, 'slow heartbeat requests must not accumulate')
    controller.abort()
    releaseHydration(); releaseHeartbeat()
    await running
    const afterShutdown = heartbeats
    context.mock.timers.tick(120000)
    assert.equal(heartbeats, afterShutdown, 'shutdown must clear the host heartbeat timer')
    await f.emit({ type: 'completed', payload: { usage: {} } })
  } finally {
    controller.abort(); releaseHydration(); releaseHeartbeat(); await running
    await f.cleanup()
  }
})

test('strict old servers can decline drive capability without losing supported extensions or masking auth errors', async () => {
  for (const status of [400, 401]) {
    const f = await fixture(), attempts: HostCapabilities[] = [], controller = new AbortController()
    try {
      f.options.controlPlane.updateCapabilities = async capabilities => {
        attempts.push(capabilities)
        if (capabilities.drive) throw new ControlPlaneRequestError(status)
      }
      controller.abort()
      if (status === 401) {
        await assert.rejects(f.runtime.run(controller.signal), error => error instanceof ControlPlaneRequestError && error.status === 401)
        assert.equal(attempts.length, 1)
      } else {
        await f.runtime.run(controller.signal)
        assert.equal(attempts.length, 2)
        assert.equal(attempts[1]?.drive, undefined)
        assert.deepEqual(attempts[1]?.mcp, { approvalBridge: true })
        assert.deepEqual(attempts[1]?.streaming, { textDeltas: true, heartbeats: true })
      }
    } finally { await f.cleanup() }
  }
})
