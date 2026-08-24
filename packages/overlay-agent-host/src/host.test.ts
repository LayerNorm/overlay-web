import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OVERLAY_AGENT_PROTOCOL_VERSION, type AgentHostCommand, type CommandAcknowledgement, type EventAcknowledgement, type EventBatch } from '@overlay/agent-bridge-protocol'
import { loadOrCreateDeviceKeyPair } from './device-key'
import { diagnoseHost } from './doctor'
import { FakeAgentAdapter } from './fake-adapter'
import { resolveFilesystemScope } from './filesystem-policy'
import { redact } from './logger'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'
import type { AgentControlPlaneClient } from './transport'

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
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600)
    assert.match(await readFile(keyPath, 'utf8'), /PRIVATE KEY/)
    assert.deepEqual(redact({ token: 'secret', nested: { password: 'secret', safe: 'value' } }), { token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'value' } })
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
