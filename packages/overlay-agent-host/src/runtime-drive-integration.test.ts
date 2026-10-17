import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {setImmediate} from 'node:timers/promises'
import type { AgentHostCommand, DriveCredentialsRequest, EventBatch, FilesystemGrant, HostCapabilities } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapter, EmitAgentEvent, StartAdapterSessionInput } from './adapter.js'
import { AgentHostRuntime, type AgentHostRuntimeOptions } from './runtime.js'
import { SqliteHostStateStore } from './state.js'
import { ControlPlaneRequestError, type AgentControlPlaneClient } from './transport.js'

function deferred<T>() {
  let resolve: (value: T) => void = () => {throw Error('not initialized')}
  const promise = new Promise<T>(accept => {resolve = accept})
  return {promise, resolve}
}

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

test('negotiated preparation stays fenced and visible while hydration blocks provider startup', async t => {
  t.mock.timers.enable({apis: ['setInterval']})
  const f = await fixture(), blocked = deferred<void>(), began = deferred<void>()
  const drive = f.options.drive
  assert.ok(drive?.create)
  const create = drive.create
  drive.create = async options => {began.resolve(); await blocked.promise; return create(options)}
  f.command.payload.metadata.overlayPreparation = 1
  try {
    const pending = f.runtime.processCommand(f.command)
    await began.promise
    await f.runtime.flushOutbox()
    assert.equal(f.starts.length, 0)
    const preparing = f.events.flatMap(batch => batch.events).filter(event => event.type === 'session_preparing')
    assert.equal(preparing.length, 1)
    assert.equal(preparing[0].execution?.attemptId, 'attempt')
    assert.ok(preparing[0].execution?.hostBootId)
    t.mock.timers.tick(10_000)
    await setImmediate()
    await f.runtime.flushOutbox()
    assert.equal(f.starts.length, 0)
    assert.equal(f.events.flatMap(batch => batch.events).filter(event => event.type === 'session_preparing').length, 2)
    blocked.resolve()
    await pending
    await f.runtime.flushOutbox()
    assert.equal(f.starts.length, 1)
    const started = f.events.flatMap(batch => batch.events).find(event => event.type === 'session_started')
    assert.deepEqual(started?.execution, preparing[0].execution)
  } finally {blocked.resolve(); await f.cleanup()}
})

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

test('native completion cannot revoke drive authority while its final save is pending', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = await fixture(), saving = deferred<void>(), release = deferred<void>()
  const drive = f.options.drive
  assert.ok(drive?.create)
  const create = drive.create, adapter = f.options.adapters[0], start = adapter.start.bind(adapter)
  let finished = false, writable = true
  adapter.start = async (...args) => ({ ...await start(...args), observe: async () => finished ? 'lost' : 'live' })
  f.options.controlPlane.pollCommands = async () => ({ commands: [], streaming: { textDeltas: true, heartbeats: true } })
  const upload = f.options.controlPlane.uploadEvents.bind(f.options.controlPlane)
  f.options.controlPlane.uploadEvents = async batch => {
    if (batch.events.some(event => event.type === 'heartbeat' && event.payload.process === 'lost')) writable = false
    return upload(batch)
  }
  drive.create = async input => ({ ...await create(input), sync: async final => {
    if (final) { saving.resolve(); await release.promise }
    if (!writable) throw Error('DRIVE_RUN_UNAVAILABLE')
    return []
  } })
  let ending: Promise<void> | undefined
  try {
    await f.runtime.pollOnce(0)
    await f.runtime.processCommand(f.command)
    finished = true
    ending = f.emit({ type: 'completed', payload: { usage: {} } })
    await saving.promise
    t.mock.timers.tick(10_000)
    await setImmediate()
    await f.runtime.flushOutbox()
    assert.equal(writable, true, 'a naturally finished provider must not revoke the pending final save')
    assert.equal(f.events.flatMap(batch => batch.events).some(event => event.type === 'completed'), false)
    release.resolve()
    await ending
    await f.runtime.flushOutbox()
    assert.equal(f.events.flatMap(batch => batch.events).at(-1)?.type, 'completed')
  } finally { release.resolve(); await ending; await f.cleanup() }
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

test('a fresh runtime stream uses the canonical continuation offset from its command', async () => {
  const f = await fixture()
  try {
    if (f.command.type !== 'start') throw Error('Missing start fixture')
    f.command.payload.fresh = true
    f.command.payload.metadata.recoveryTextOffset = 28
    await f.runtime.processCommand(f.command)
    await f.emit({ type: 'text_checkpoint', payload: { text: 'Continued ✓', final: true } })
    await f.emit({ type: 'completed', payload: { usage: {} } })
    await f.runtime.flushOutbox()
    assert.deepEqual(f.events.flatMap(batch => batch.events).find(event => event.type === 'text_checkpoint')?.payload,
      { text: 'Continued ✓', offset: 28, final: true })
  } finally { await f.cleanup() }
})

test('invalid recovery offsets fail before provider credentials, drive ownership or session start', async () => {
  const f = await fixture()
  try {
    if (f.command.type !== 'start') throw Error('Missing start fixture')
    f.command.payload.fresh = true
    f.command.payload.metadata.recoveryTextOffset = -1
    await assert.rejects(f.runtime.processCommand(f.command), /Invalid recovery text offset/)
    assert.deepEqual(f.order, [])
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
    assert.equal(f.starts.length, 0, 'a shutdown during hydration must not launch a provider afterwards')
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
        controller.abort()
      }
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

test('shutdown during adapter initialization stops the returned session without sending its first prompt', async () => {
  const f = await fixture(), controller = new AbortController()
  const adapter = f.options.adapters[0], start = adapter.start.bind(adapter)
  let stopped = false
  try {
    adapter.start = async (input, emit) => {
      const session = await start(input, emit)
      controller.abort()
      return {...session, async stop() { stopped = true; await session.stop() }}
    }
    f.options.controlPlane.pollCommands = async () => ({ commands: [f.command] })
    await f.runtime.run(controller.signal)
    assert.equal(f.starts.length, 1)
    assert.equal(stopped, true)
    assert.equal(f.order.includes('prompt'), false)
    assert.equal(f.runtime.canCloseState, true)
  } finally { controller.abort(); await f.cleanup() }
})

test('an already aborted host does not discover capabilities, heartbeat or poll commands', async () => {
  const f = await fixture(), controller = new AbortController()
  let requests = 0
  try {
    f.options.controlPlane.updateCapabilities = async () => { requests++ }
    f.options.controlPlane.heartbeat = async () => { requests++ }
    f.options.controlPlane.pollCommands = async () => { requests++; return { commands: [f.command] } }
    controller.abort()
    await f.runtime.run(controller.signal)
    assert.equal(requests, 0)
    assert.equal(f.starts.length, 0)
    assert.equal(f.runtime.canCloseState, true)
  } finally { await f.cleanup() }
})
