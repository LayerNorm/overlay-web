import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostCommand,
  type EventAcknowledgement,
  type EventBatch,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapter, EmitAgentEvent, StartAdapterSessionInput } from './adapter'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'
import { ControlPlaneRequestError, type AgentControlPlaneClient } from './transport'

class CapturingAdapter implements AgentAdapter {
  readonly capability = { id: 'claude-code', displayName: 'Claude Code', protocol: 'acp' as const, supports: { prompt: true, approval: true, cancel: true, resume: true } }
  starts: StartAdapterSessionInput[] = []
  completeOnStart = false
  discoveries: Array<Parameters<AgentAdapter['discover']>[0]> = []
  async discover(input?: Parameters<AgentAdapter['discover']>[0]) { this.discoveries.push(input); return this.capability }
  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent) {
    this.starts.push(input)
    if (this.completeOnStart) await emit({type: 'completed', payload: {usage: {}}})
    return {
      remoteSessionId: 'remote-1', initialPromptHandled: true,
      prompt: async () => undefined, approve: async () => undefined, elicit: async () => undefined,
      cancel: async () => undefined, resume: async () => undefined, stop: async () => undefined,
    }
  }
}

class Plane implements AgentControlPlaneClient {
  commands: AgentHostCommand[] = []
  events: EventBatch[] = []
  fetched: string[] = []
  discoveryFetched: string[] = []
  discoveryResult: Record<string, string> | Error = { CLAUDE_CODE_OAUTH_TOKEN: 'catalog-token' }
  async fetchDiscoveryCredentials(adapterId: string) {
    this.discoveryFetched.push(adapterId)
    if (this.discoveryResult instanceof Error) throw this.discoveryResult
    return this.discoveryResult
  }
  credentialsResult: Record<string, string> | Error = { CLAUDE_CODE_OAUTH_TOKEN: 'token-for-this-run' }
  private cursor = 0
  async pollCommands() { return { commands: this.commands.splice(0) } }
  async acknowledgeCommand() {}
  async uploadEvents(batch: EventBatch): Promise<EventAcknowledgement> {
    this.events.push(batch)
    this.cursor = batch.events.at(-1)!.sourceSequence
    return { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, accepted: true, acknowledgedSequence: this.cursor }
  }
  async fetchRunCredentials(runId: string) {
    this.fetched.push(runId)
    if (this.credentialsResult instanceof Error) throw this.credentialsResult
    return this.credentialsResult
  }
}

async function setup(options: { fetchRunCredentials?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-run-credentials-'))
  const root = join(directory, 'workspace')
  await mkdir(root)
  const state = new SqliteHostStateStore(join(directory, 'state', 'host.sqlite'))
  const plane = new Plane()
  const adapter = new CapturingAdapter()
  const runtime = new AgentHostRuntime({
    environmentId: 'environment-1', workspaceId: 'workspace-1', filesystem: { mode: 'selected_roots', roots: [root] },
    adapters: [adapter], state, controlPlane: plane, ...options,
  })
  const start = (metadata: Record<string, unknown>) => ({
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, commandId: `c-${Math.random()}`, environmentId: 'environment-1',
    workspaceId: 'workspace-1', runId: 'run-1', sequence: 1, issuedAt: Date.now(), type: 'start',
    payload: { bindingId: 'b', adapterId: 'claude-code', workingDirectory: root, prompt: 'hi', metadata },
  } as AgentHostCommand)
  const cleanup = async () => { state.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  return { plane, adapter, runtime, start, cleanup }
}

const eventTypes = (plane: Plane) => plane.events.flatMap((batch) => batch.events.map((event) => event.type))

test('a run that asks for credentials gets them, in memory, for its agent process', async () => {
  const { plane, adapter, runtime, start, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    plane.commands.push(start({ runCredentials: true }))
    await runtime.pollOnce(0)
    assert.deepEqual(plane.fetched, ['run-1'])
    assert.deepEqual(adapter.starts[0]?.credentials, { CLAUDE_CODE_OAUTH_TOKEN: 'token-for-this-run' })
    // The credential is not part of the metadata that is stored and logged.
    assert.equal(JSON.stringify(adapter.starts[0]?.metadata).includes('token-for-this-run'), false)
  } finally { await cleanup() }
})

test('a binding with no account starts without credentials', async () => {
  const { plane, adapter, runtime, start, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    plane.credentialsResult = new ControlPlaneRequestError(409, 'provider_account_missing')
    plane.commands.push(start({}))
    await runtime.pollOnce(0)
    assert.equal(adapter.starts.length, 1)
    assert.equal(adapter.starts[0]?.credentials, undefined)
  } finally { await cleanup() }
})

test('an account that needs reconnecting fails the run as auth_required without starting the agent', async () => {
  const { plane, adapter, runtime, start, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    plane.credentialsResult = new ControlPlaneRequestError(409, 'account_needs_reauth')
    plane.commands.push(start({ runCredentials: true }))
    await runtime.pollOnce(0)
    assert.equal(adapter.starts.length, 0)
    const failed = plane.events.flatMap((batch) => batch.events).find((event) => event.type === 'failed')
    assert.equal((failed?.payload as { code?: string } | undefined)?.code, 'auth_required')
  } finally { await cleanup() }
})

test('other lookup failures are retryable and never named as sign-in problems', async () => {
  const { plane, runtime, start, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    plane.credentialsResult = new ControlPlaneRequestError(503, 'provider_accounts_unavailable')
    plane.commands.push(start({ runCredentials: true }))
    await runtime.pollOnce(0)
    const failed = plane.events.flatMap((batch) => batch.events).find((event) => event.type === 'failed')
    assert.deepEqual({ code: (failed?.payload as { code?: string }).code, retryable: (failed?.payload as { retryable?: boolean }).retryable },
      { code: 'credentials_unavailable', retryable: true })
  } finally { await cleanup() }
})

test('a host that does not fetch credentials never asks, even if a command says so', async () => {
  const { plane, adapter, runtime, start, cleanup } = await setup()
  try {
    plane.commands.push(start({ runCredentials: true }))
    await runtime.pollOnce(0)
    assert.equal(eventTypes(plane).includes('session_started'), true)
    assert.deepEqual(plane.fetched, [])
    assert.equal(adapter.starts[0]?.credentials, undefined)
  } finally { await cleanup() }
})


test('Cloud catalog discovery receives its bound account before the first run', async () => {
  const { plane, adapter, runtime, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    await runtime.discoverCapabilities()
    assert.deepEqual(plane.discoveryFetched, ['claude-code'])
    assert.deepEqual(adapter.discoveries[0]?.credentials, { CLAUDE_CODE_OAUTH_TOKEN: 'catalog-token' })
    assert.deepEqual(plane.fetched, [])
    assert.deepEqual(adapter.starts, [])
    assert.deepEqual(plane.events, [])
  } finally { await cleanup() }
})

test('catalog lookup failure leaves fallback options without starting an unsigned-in probe or a task', async () => {
  const { plane, adapter, runtime, cleanup } = await setup({ fetchRunCredentials: true })
  try {
    plane.discoveryResult = new ControlPlaneRequestError(409, 'provider_discovery_busy')
    await runtime.discoverCapabilities()
    assert.deepEqual(plane.discoveryFetched, ['claude-code'])
    assert.deepEqual(adapter.discoveries, [])
    assert.deepEqual(adapter.starts, [])
    assert.deepEqual(plane.events, [])
  } finally { await cleanup() }
})

test('local catalog discovery uses local sign-in without requesting Cloud credentials', async () => {
  const { plane, adapter, runtime, cleanup } = await setup()
  try {
    await runtime.discoverCapabilities()
    assert.deepEqual(plane.discoveryFetched, [])
    assert.equal(adapter.discoveries.length, 1)
    assert.equal(adapter.discoveries[0]?.credentials, undefined)
  } finally { await cleanup() }
})


test('catalog publication during active native work never fetches credentials or opens another provider session', async () => {
  const {plane, adapter, runtime, start, cleanup} = await setup({fetchRunCredentials: true})
  try {
    plane.commands.push(start({runCredentials: true}))
    await runtime.pollOnce(0)
    const discoveries = adapter.discoveries.length, fetched = plane.discoveryFetched.length
    assert.equal(adapter.starts.length, 1)
    assert.deepEqual(await runtime.discoverCapabilities(), [adapter.capability])
    assert.equal(adapter.discoveries.length, discoveries)
    assert.equal(plane.discoveryFetched.length, fetched)
  } finally { await cleanup() }
})


test('completed retained sessions do not prevent a later idle catalog refresh', async () => {
  const {plane, adapter, runtime, start, cleanup} = await setup({fetchRunCredentials: true})
  try {
    adapter.completeOnStart = true
    plane.commands.push(start({runCredentials: true}))
    await runtime.pollOnce(0)
    const fetched = plane.discoveryFetched.length
    await runtime.discoverCapabilities()
    assert.equal(plane.discoveryFetched.length, fetched + 1)
    assert.equal(adapter.starts.length, 1)
  } finally { await cleanup() }
})
