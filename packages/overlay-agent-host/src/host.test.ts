import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createPublicKey, verify } from 'node:crypto'
import test from 'node:test'
import { OVERLAY_AGENT_PROTOCOL_VERSION, canonicalEnrollmentProof, canonicalHostRequestProof, type AgentHostCommand, type CommandAcknowledgement, type EventAcknowledgement, type EventBatch } from '@layernorm/overlay-agent-bridge-protocol'
import { loadOrCreateDeviceKeyPair } from './device-key'
import { diagnoseHost } from './doctor'
import { FakeAgentAdapter } from './fake-adapter'
import {AcpAgentAdapter} from './acp-adapter'
import type {AgentAdapter, AgentAdapterSession} from './adapter'
import {fileURLToPath} from 'node:url'
import { resolveFilesystemScope } from './filesystem-policy'
import { redact } from './logger'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'
import type { AgentControlPlaneClient } from './transport'
import { HttpAgentControlPlaneClient } from './transport'
import { connectAgentHost } from './enrollment'
import { loadStoredConnection } from './connection'

class FakeControlPlane implements AgentControlPlaneClient {
  commands: AgentHostCommand[] = []
  acknowledgements: CommandAcknowledgement[] = []
  applied: EventBatch[] = []
  failUploads = 0
  failAcknowledgements = 0
  serverCursor = new Map<string, number>()

  async pollCommands() { const commands = this.commands.splice(0); return { commands } }
  async acknowledgeCommand(value: CommandAcknowledgement) {
    if (this.failAcknowledgements-- > 0) throw new Error('simulated acknowledgement outage')
    this.acknowledgements.push(value)
  }
  async uploadEvents(batch: EventBatch): Promise<EventAcknowledgement> {
    if (this.failUploads-- > 0) throw new Error('simulated server outage')
    const expected = (this.serverCursor.get(batch.runId) ?? 0) + 1
    if (batch.events[0].sourceSequence !== expected) return { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, accepted: false, expectedSequence: expected }
    this.applied.push(batch)
    const acknowledgedSequence = batch.events.at(-1)!.sourceSequence
    this.serverCursor.set(batch.runId, acknowledgedSequence)
    return { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, accepted: true, acknowledgedSequence }
  }
}

test('a host without fenced restoration admission rejects the command before starting any session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-restore-admission-'))
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  try {
    const controlPlane = new FakeControlPlane(), runtime = createRuntime(state, controlPlane, directory)
    controlPlane.commands.push(command('restore', 'run', 1, 'start', {
      bindingId: 'binding', adapterId: 'fake', workingDirectory: directory, prompt: 'Continue', sessionId: 'original-native-session',
      restore: {previousExecution: {attemptId: 'previous', generation: 1},
        providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}, metadata: {},
    }))
    await assert.rejects(runtime.pollOnce(0), /cannot admit fenced native restoration/)
    await runtime.flushOutbox()
    assert.equal(controlPlane.acknowledgements[0]?.accepted, false)
    assert.match(controlPlane.acknowledgements[0]?.error?.message ?? '', /cannot admit fenced native restoration/)
    assert.equal(state.getSession('run'), undefined)
    assert.equal(eventTypes(controlPlane).includes('session_started'), false)
  } finally {state.close(); await rm(directory, {recursive: true, force: true})}
})

test('fenced restoration loads the original native session and appends only new output at the canonical offset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-native-restore-')), root = await realpath(directory)
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  let loaded: AgentAdapterSession | undefined
  const real = new AcpAgentAdapter({id: 'history', displayName: 'History fixture', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/acp-load-history-agent.mjs', import.meta.url))]})
  if (!real.capability.recovery) throw Error('Fixture requires session loading')
  real.capability.recovery.fencedSessionRestoration = true
  const adapter: AgentAdapter = {capability: real.capability, discover: input => real.discover(input), async start(input, emit) {
    loaded = await real.start(input, emit); return loaded
  }}
  try {
    state.claimExecution('run', 'previous')
    state.saveSession({runId: 'run', adapterId: 'history', remoteSessionId: 'original-session', workingDirectory: root,
      execution: {attemptId: 'previous', generation: 1, hostBootId: 'old-boot'}})
    state.saveAdapterSessionState('run', 'history', {identity: 'must survive takeover'})
    const plane = new FakeControlPlane()
    plane.pollCommands = async () => ({commands: plane.commands.splice(0), streaming: {textDeltas: true, heartbeats: true}})
    const runtime = new AgentHostRuntime({environmentId: 'environment-1', workspaceId: 'workspace-1', durableLifecycle: true,
      filesystem: {mode: 'selected_roots', roots: [root]}, adapters: [adapter], state, controlPlane: plane})
    const start = {...command('restore', 'run', 1, 'start', {bindingId: 'binding', adapterId: 'history', workingDirectory: root,
      sessionId: 'original-session', prompt: 'Continue after interruption', metadata: {recoveryTextOffset: 17},
      restore: {previousExecution: {attemptId: 'previous', generation: 1, hostBootId: 'old-boot'},
        providerStop: {provider: 'box', leaseId: 'original-lease', providerReference: 'original-machine', observedAt: Date.now()}}}),
      execution: {attemptId: 'restored', generation: 2}}
    plane.commands.push(start)
    await runtime.pollOnce(0)
    await waitFor(() => eventTypes(plane).includes('completed'))
    const events = plane.applied.flatMap(batch => batch.events)
    assert.deepEqual(events.filter(e => e.type === 'text_delta').map(e => e.payload), [{offset: 17, text: 'NEW_OUTPUT'}])
    assert.ok(events.every(e => e.execution?.attemptId === 'restored' && e.execution.generation === 2))
    assert.equal(state.getSession('run')?.remoteSessionId, 'original-session')
    assert.deepEqual(state.getAdapterSessionState('run', 'history'), {identity: 'must survive takeover'})
    assert.equal(state.replaceExecutionClaim('run', 'previous', 'another-attempt'), false)
    plane.commands.push({...start, commandId: 'duplicate-restore', sequence: 2})
    await assert.rejects(runtime.pollOnce(0), /live session|previous execution fence/)
  } finally {await loaded?.stop(); state.close(); await rm(directory, {recursive: true, force: true})}
})

test('restoration refuses a changed physical working directory before starting its adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-restore-scope-')), root = await realpath(directory)
  const original = join(root, 'original'), other = join(root, 'other')
  await mkdir(original); await mkdir(other)
  const state = new SqliteHostStateStore(join(root, 'host.sqlite'))
  try {
    const fake = new FakeAgentAdapter()
    const adapter: AgentAdapter = {capability: {...fake.capability,
      recovery: {...fake.capability.recovery, fencedSessionRestoration: true}}, discover: () => fake.discover(),
      async start() {assert.fail('A mismatched scope must not start a provider')}}
    state.claimExecution('run', 'previous')
    state.saveSession({runId: 'run', adapterId: 'fake', remoteSessionId: 'original-native', workingDirectory: original,
      execution: {attemptId: 'previous', generation: 1}})
    const plane = new FakeControlPlane()
    plane.commands.push({...command('restore', 'run', 1, 'start', {bindingId: 'binding', adapterId: 'fake', workingDirectory: other,
      sessionId: 'original-native', prompt: 'Continue', metadata: {recoveryTextOffset: 0},
      restore: {previousExecution: {attemptId: 'previous', generation: 1},
        providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}}),
      execution: {attemptId: 'new', generation: 2}})
    const runtime = new AgentHostRuntime({environmentId: 'environment-1', workspaceId: 'workspace-1', durableLifecycle: true,
      filesystem: {mode: 'selected_roots', roots: [root]}, adapters: [adapter], state, controlPlane: plane})
    await assert.rejects(runtime.pollOnce(0), /original working directory/)
    assert.equal(state.getSession('run')?.remoteSessionId, 'original-native')
  } finally {state.close(); await rm(directory, {recursive: true, force: true})}
})

test('restoration keeps the old claim through failed preparation and joins duplicate preparation before one native start', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-native-preparation-')), root = await realpath(directory)
  const state = new SqliteHostStateStore(join(root, 'host.sqlite'))
  let starts = 0, preparations = 0, loaded: AgentAdapterSession | undefined
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => {release = resolve})
  const fake = new FakeAgentAdapter()
  const adapter: AgentAdapter = {capability: {...fake.capability, recovery: {...fake.capability.recovery,
    fencedSessionRestoration: true, interruptedTurnContinuation: false}}, discover: async () => adapter.capability, async start(input, emit) {
    starts++
    assert.equal(state.getSession('run')?.execution?.attemptId, 'next', 'ownership is durable before native code starts')
    loaded = await fake.start(input, emit); return loaded
  }}
  const plane = Object.assign(new FakeControlPlane(), {
    refreshFilesystemGrant: async () => ({mode: 'selected_roots' as const, roots: [root]}),
    fetchDriveCredentials: async () => ({protocolVersion: 1 as const, scope: {kind: 'personal' as const,
      workspaceId: 'workspace-1', ownerUserId: 'owner'}, token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}`, expiresAt: Date.now() + 60000}),
  })
  try {
    state.claimExecution('run', 'previous')
    state.saveSession({runId: 'run', adapterId: 'fake', remoteSessionId: 'original-native', workingDirectory: root,
      execution: {attemptId: 'previous', generation: 1}})
    const runtime = new AgentHostRuntime({environmentId: 'environment-1', workspaceId: 'workspace-1', durableLifecycle: true,
      filesystem: {mode: 'selected_roots', roots: [root]}, adapters: [adapter], state, controlPlane: plane,
      drive: {stateDirectory: root, apiUrl: 'https://preview.invalid/api/agent-drive', create: async () => {
        preparations++
        if (preparations === 1) throw Error('preparation temporarily unavailable')
        await gate
        return {workingDirectory: root, additionalDirectories: [], sync: async () => [], close: async () => undefined}
      }}})
    const start = {...command('first-restore', 'run', 1, 'start', {bindingId: 'binding', adapterId: 'fake', workingDirectory: root,
      prompt: 'Continue', sessionId: 'original-native', metadata: {recoveryTextOffset: 0,
        overlayDrive: {version: 1, sessionId: 'next', location: 'approved-root'}},
      restore: {previousExecution: {attemptId: 'previous', generation: 1},
        providerStop: {provider: 'box', leaseId: 'lease', providerReference: 'machine', observedAt: 1}}}),
      execution: {attemptId: 'next', generation: 2}}
    await assert.rejects(runtime.processCommand(start), /temporarily unavailable/)
    assert.equal(starts, 0)
    assert.equal(state.getSession('run')?.execution?.attemptId, 'previous')
    // The server authorizes a new delivery for the same execution; an uncertain native start never reaches this path.
    const retry = {...start, commandId: 'retry-restore', sequence: 2}
    const first = runtime.processCommand(retry), duplicate = runtime.processCommand(retry)
    await waitFor(() => preparations === 2)
    assert.equal(starts, 0)
    assert.equal(state.getSession('run')?.execution?.attemptId, 'previous')
    if (!release) throw Error('Missing preparation gate')
    release()
    await Promise.all([first, duplicate])
    await waitFor(() => eventTypes(plane).includes('completed'))
    assert.equal(starts, 1)
    assert.equal(preparations, 2)
    assert.equal(state.getSession('run')?.remoteSessionId, 'original-native')
  } finally {release?.(); await loaded?.stop(); state.close(); await rm(directory, {recursive: true, force: true})}
})

test('host conformance: start, stream, approval, cancel, duplicates, outage, crash, reconnect and resume', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-'))
  const root = join(directory, 'workspace')
  await mkdir(root)
  const databasePath = join(directory, 'state', 'host.sqlite')
  const controlPlane = new FakeControlPlane()
  let state = new SqliteHostStateStore(databasePath)
  let runtime = createRuntime(state, controlPlane, root)
  try {
    const start = command('start-1', 'run-1', 1, 'start', { bindingId: 'binding-1', adapterId: 'fake', workingDirectory: root, prompt: 'hello', metadata: {} })
    controlPlane.commands.push(start)
    await runtime.pollOnce(0)
    await waitFor(() => eventTypes(controlPlane).includes('completed'))
    assert.deepEqual(eventTypes(controlPlane).slice(0, 3), ['session_started', 'text_checkpoint', 'completed'])

    controlPlane.commands.push(start)
    await runtime.pollOnce(0)
    assert.equal(eventTypes(controlPlane).filter((type) => type === 'session_started').length, 1)
    assert.equal(controlPlane.acknowledgements.filter((ack) => ack.commandId === start.commandId).length, 2)

    controlPlane.commands.push(command('prompt-approval', 'run-1', 2, 'prompt', { prompt: '[approval]' }))
    await runtime.pollOnce(0)
    await waitFor(() => eventTypes(controlPlane).includes('approval_requested'))
    controlPlane.commands.push(command('approval-1', 'run-1', 3, 'approval_response', { requestKey: 'fake-permission', optionId: 'allow_once' }))
    await runtime.pollOnce(0)
    assert.ok(eventTypes(controlPlane).includes('action'))

    controlPlane.failUploads = 2
    controlPlane.commands.push(command('cancel-1', 'run-1', 4, 'cancel', { reason: 'user cancelled' }))
    await runtime.pollOnce(0).catch(() => undefined)
    assert.ok(state.outboxSize() > 0, 'failed uploads remain in SQLite')
    // The poll no longer waits on the uploader. Settle that failed pass before requesting an explicit retry.
    await runtime.flushOutbox().catch(() => undefined)
    controlPlane.failUploads = 0
    await runtime.flushOutbox()
    assert.equal(state.outboxSize(), 0)
    assert.ok(eventTypes(controlPlane).includes('cancelled'))

    state.close()
    state = new SqliteHostStateStore(databasePath)
    runtime = createRuntime(state, controlPlane, root)
    const persisted = state.getSession('run-1')!
    controlPlane.commands.push(command('reconnect-1', 'run-1', 5, 'reconnect', { remoteSessionId: persisted.remoteSessionId }))
    await runtime.pollOnce(0)
    assert.ok(eventTypes(controlPlane).filter((type) => type === 'action').length >= 2)
    assert.equal(state.hasProcessedCommand('start-1'), true)
    await assert.rejects(runtime.processCommand(command('out-of-order', 'run-1', 7, 'prompt', { prompt: 'gap' })), /expected command sequence 6/)
    assert.equal(state.commandCursor(), 5)
  } finally {
    state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a fresh host adopts the server command stream position instead of rejecting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-adopt-'))
  const root = join(directory, 'workspace')
  await mkdir(root)
  const databasePath = join(directory, 'state', 'host.sqlite')
  const controlPlane = new FakeControlPlane()
  const state = new SqliteHostStateStore(databasePath)
  const runtime = createRuntime(state, controlPlane, root)
  try {
    // The server stream already consumed sequence 1 in a previous host
    // incarnation, so the first delivered command arrives at sequence 2.
    controlPlane.commands.push(command('late-start', 'run-1', 2, 'start', { bindingId: 'binding-1', adapterId: 'fake', workingDirectory: root, prompt: 'hello', metadata: {} }))
    await runtime.pollOnce(0)
    await waitFor(() => eventTypes(controlPlane).includes('completed'))
    assert.equal(state.commandCursor(), 2)
    assert.equal(controlPlane.acknowledgements.at(-1)?.accepted, true)

    controlPlane.commands.push(command('next-1', 'run-2', 3, 'start', { bindingId: 'binding-1', adapterId: 'fake', workingDirectory: root, prompt: 'next', metadata: {} }))
    await runtime.pollOnce(0)
    assert.equal(state.commandCursor(), 3)

    await assert.rejects(runtime.processCommand(command('gap-1', 'run-3', 7, 'prompt', { prompt: 'gap' })), /expected command sequence 4/)
    assert.equal(state.commandCursor(), 3)
    assert.equal(state.adoptCommandCursor(9), false, 'adoption is refused once the store has a cursor')
    assert.equal(state.commandCursor(), 3)
  } finally {
    state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('host load rehearsal drains a command burst and reconnects every persisted session after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-storm-'))
  const root = join(directory, 'workspace')
  const databasePath = join(directory, 'state', 'host.sqlite')
  await mkdir(root)
  const controlPlane = new FakeControlPlane()
  let state = new SqliteHostStateStore(databasePath)
  let runtime = createRuntime(state, controlPlane, root)
  const runCount = 25
  try {
    for (let index = 0; index < runCount; index += 1) {
      controlPlane.commands.push(command(
        `storm-start-${index}`,
        `storm-run-${index}`,
        index + 1,
        'start',
        { bindingId: 'binding-1', adapterId: 'fake', workingDirectory: root, prompt: `storm ${index}`, metadata: {} },
      ))
    }
    await runtime.pollOnce(0)
    await waitFor(() => eventTypes(controlPlane).filter((type) => type === 'completed').length >= runCount)
    assert.equal(state.commandCursor(), runCount)

    const sessions = Array.from({ length: runCount }, (_, index) => state.getSession(`storm-run-${index}`)!)
    state.close()
    state = new SqliteHostStateStore(databasePath)
    runtime = createRuntime(state, controlPlane, root)
    for (let index = 0; index < runCount; index += 1) {
      controlPlane.commands.push(command(
        `storm-reconnect-${index}`,
        `storm-run-${index}`,
        runCount + index + 1,
        'reconnect',
        { remoteSessionId: sessions[index].remoteSessionId },
      ))
    }
    await runtime.pollOnce(0)
    assert.equal(state.commandCursor(), runCount * 2)
    assert.equal(
      controlPlane.applied.flatMap((batch) => batch.events)
        .filter((event) => event.type === 'action' && event.payload.actionId === 'resume').length,
      runCount,
    )
  } finally {
    state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('filesystem policy supports multiple roots and never grants outside paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-roots-'))
  const first = join(directory, 'first')
  const second = join(directory, 'second')
  const outside = join(directory, 'outside')
  await Promise.all([mkdir(first), mkdir(second), mkdir(outside)])
  try {
    const scope = await resolveFilesystemScope({ mode: 'selected_roots', roots: [first, second] }, second)
    assert.equal(scope.workingDirectory, await realpath(second))
    assert.ok(scope.additionalDirectories.includes(await realpath(first)))
    await assert.rejects(resolveFilesystemScope({ mode: 'selected_roots', roots: [first, second] }, outside))
    assert.equal((await resolveFilesystemScope({ mode: 'all_user_files' }, outside)).workingDirectory, await realpath(outside))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('an acknowledgement outage preserves the accepted command result for safe retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-ack-'))
  const root = join(directory, 'workspace')
  await mkdir(root)
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite'))
  const controlPlane = new FakeControlPlane()
  const runtime = createRuntime(state, controlPlane, root)
  const start = command('start-ack', 'run-ack', 1, 'start', { bindingId: 'binding-1', adapterId: 'fake', workingDirectory: root, prompt: 'hello', metadata: {} })
  try {
    controlPlane.failAcknowledgements = 1
    await assert.rejects(runtime.processCommand(start), /acknowledgement outage/)
    assert.deepEqual(state.getProcessedCommand(start.commandId), { sequence: 1, accepted: true })
    await runtime.processCommand(start)
    assert.equal(controlPlane.acknowledgements.at(-1)?.accepted, true)
    await waitFor(() => eventTypes(controlPlane).includes('completed'))
    assert.equal(eventTypes(controlPlane).filter((type) => type === 'session_started').length, 1)
  } finally {
    state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('device keys persist privately and logs redact credential fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-key-'))
  try {
    const first = await loadOrCreateDeviceKeyPair(directory)
    const second = await loadOrCreateDeviceKeyPair(directory)
    assert.deepEqual(first, second)
    const keyPath = join(directory, 'keys', 'device-private.pem')
    await assertPrivateStateFile(keyPath)
    assert.match(await readFile(keyPath, 'utf8'), /PRIVATE KEY/)
    assert.deepEqual(redact({ token: 'secret', nested: { password: 'secret', safe: 'value' } }), { token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'value' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('state cannot be reused by a different environment or workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-state-scope-'))
  const path = join(directory, 'host.sqlite')
  try {
    const state = new SqliteHostStateStore(path, { environmentId: 'environment-1', workspaceId: 'workspace-1' })
    state.close()
    assert.throws(
      () => new SqliteHostStateStore(path, { environmentId: 'environment-2', workspaceId: 'workspace-1' }),
      /host state scope does not match the host configuration/,
    )
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('doctor validates state, device key, SQLite and adapter discovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-doctor-'))
  try {
    const checks = await diagnoseHost({
      environmentId: 'environment-1', workspaceId: 'workspace-1', controlPlaneUrl: 'https://overlay.invalid/',
      credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL', credential: 'not-logged', stateDirectory: directory,
      filesystem: { mode: 'all_user_files' }, adapters: [{ id: 'fake', displayName: 'Fake', protocol: 'fake' }],
    }, [new FakeAgentAdapter()])
    assert.equal(checks.every((check) => check.ok), true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('connect enrolls a device, proves key possession, and stores only the short-lived credential privately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-connect-'))
  let publicKey = ''
  let credentialAttempts = 0
  try {
    const connection = await connectAgentHost({
      code: 'single-use-enrollment-code-1234',
      serverUrl: 'https://overlay.example',
      stateDirectory: directory,
      waitTimeoutMs: 5_000,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/enroll')) {
          const body = JSON.parse(String(init?.body)) as { publicKey: string }
          publicKey = body.publicKey
          return Response.json({
            protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1',
            verificationPhrase: 'amber-river-sage', proofChallenge: 'proof-challenge-with-enough-entropy-1234',
            proofChallengeExpiresAt: Date.now() + 60_000,
          }, { status: 201 })
        }
        credentialAttempts += 1
        const body = JSON.parse(String(init?.body)) as { proofChallenge: string; signature: string }
        assert.equal(verify(
          null,
          Buffer.from(canonicalEnrollmentProof('environment-1', body.proofChallenge)),
          createPublicKey(publicKey),
          Buffer.from(body.signature, 'base64url'),
        ), true)
        if (credentialAttempts === 1) return Response.json({ code: 'environment_pending' }, { status: 425 })
        return Response.json({
          protocolVersion: 1, workspaceId: 'workspace-1', environmentId: 'environment-1',
          audience: 'overlay-agent-control-plane', methods: ['agent:commands:poll'],
          token: 'short-lived-environment-credential-123456789', expiresAt: Date.now() + 60_000,
          filesystemGrant: { mode: 'selected_roots', roots: ['/workspace/project'] },
        }, { status: 201 })
      },
    })
    assert.equal(connection.environmentId, 'environment-1')
    assert.equal((await loadStoredConnection(directory))?.token, 'short-lived-environment-credential-123456789')
    await assertPrivateStateFile(join(directory, 'connection.json'))
    assert.equal((await readFile(join(directory, 'connection.json'), 'utf8')).includes('single-use-enrollment-code'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function assertPrivateStateFile(path: string): Promise<void> {
  const mode = (await stat(path)).mode & 0o777
  if (process.platform === 'win32') {
    // Node maps Windows ACLs onto synthetic POSIX mode bits and reports 0o666
    // even when the file inherits the current user's private profile ACL.
    assert.equal(mode, 0o666)
    return
  }
  assert.equal(mode, 0o600)
}

test('HTTP transport signs the exact method, path, body and credential hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-signed-http-'))
  try {
    const keys = await loadOrCreateDeviceKeyPair(directory)
    const credential = 'environment-credential-with-enough-entropy'
    const client = new HttpAgentControlPlaneClient({
      baseUrl: 'https://overlay.example/api/v1/agent-environments/environment-1/',
      environmentId: 'environment-1',
      credential,
      privateKey: keys.privateKey,
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        const timestamp = headers.get('x-overlay-agent-timestamp')!
        const nonce = headers.get('x-overlay-agent-nonce')!
        const signature = headers.get('x-overlay-agent-signature')!
        const canonical = canonicalHostRequestProof({
          method: init?.method ?? 'GET', pathname: `${url.pathname}${url.search}`, timestamp, nonce,
          bodySha256: createHash('sha256').update(typeof init?.body === 'string' ? init.body : '').digest('hex'),
          tokenSha256: createHash('sha256').update(credential).digest('hex'),
        })
        assert.equal(verify(null, Buffer.from(canonical), createPublicKey(keys.publicKey), Buffer.from(signature, 'base64url')), true)
        return Response.json({ protocolVersion: 1, commands: [], retryAfterMs: 1_000 })
      },
    })
    await client.pollCommands({ waitMs: 1_000 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

function createRuntime(state: SqliteHostStateStore, controlPlane: FakeControlPlane, root: string): AgentHostRuntime {
  return new AgentHostRuntime({
    environmentId: 'environment-1', workspaceId: 'workspace-1', filesystem: { mode: 'selected_roots', roots: [root] },
    adapters: [new FakeAgentAdapter()], state, controlPlane,
  })
}

function command<T extends AgentHostCommand['type']>(commandId: string, runId: string, sequence: number, type: T, payload: Extract<AgentHostCommand, { type: T }>['payload']): Extract<AgentHostCommand, { type: T }> {
  return { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, commandId, environmentId: 'environment-1', workspaceId: 'workspace-1', runId, sequence, issuedAt: Date.now(), type, payload } as Extract<AgentHostCommand, { type: T }>
}

function eventTypes(controlPlane: FakeControlPlane): string[] { return controlPlane.applied.flatMap((batch) => batch.events.map((event) => event.type)) }

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for host event')
}
