import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import type {AgentHostCommand, AgentHostEvent} from '@layernorm/overlay-agent-bridge-protocol'
import type {AgentAdapter, AgentAdapterSession} from './adapter.js'
import {AcpAgentAdapter} from './acp-adapter.js'
import {AgentHostRuntime} from './runtime.js'
import {SqliteHostStateStore} from './state.js'
import {AgentDriveLease} from './drive-lease.js'
import {PendingHostPrompts, quiesceHostRuns} from './runtime-shutdown.js'

test('an unconfirmed provider stop keeps the actual cache lease and does not drain or release its writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-unknown-stop-')), cache = join(directory, 'cache'), path = join(directory, 'private', 'lease.sqlite')
  await mkdir(cache)
  const scope = {kind: 'workspace', workspaceId: 'workspace'} as const
  const lease = AgentDriveLease.acquire(path, cache, scope)
  const calls: string[] = []
  const session: AgentAdapterSession = {remoteSessionId: 'unknown', async prompt() {}, async approve() {}, async elicit() {}, async cancel() {}, async resume() {}, async stop() {calls.push('stop'); throw Error('OS process termination is unknown')}}
  try {
    await assert.rejects(quiesceHostRuns({sessions: [session], prompts: new PendingHostPrompts(() => {}),
      streams: [{async drain() {calls.push('drain')}}],
      drives: [{stopScheduling() {calls.push('stop-timer')}, async closeAfterStopped() {calls.push('release'); lease.release()}}],
    }), /termination was not confirmed/)
    assert.deepEqual(calls, ['stop-timer', 'stop'])
    assert.throws(() => AgentDriveLease.acquire(path, cache, scope), /DRIVE_CACHE_BUSY/)
  } finally {lease.release(); await rm(directory, {recursive: true, force: true})}
})

test('host shutdown stops a real provider, retains pending text and drains an in-flight upload before SQLite closes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-host-shutdown-'))
  const statePath = join(directory, 'host.sqlite'), pidFile = join(directory, 'provider.pid')
  const state = new SqliteHostStateStore(statePath), controller = new AbortController()
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-pending-agent.mjs')
  const real = new AcpAgentAdapter({id: 'fixture', displayName: 'Pending fixture', command: process.execPath, args: [fixture, pidFile]})
  let observedSession: AgentAdapterSession | undefined, releaseUpload: () => void = () => {}, sawText: () => void = () => {}
  const uploadGate = new Promise<void>(resolve => {releaseUpload = resolve})
  const textReady = new Promise<void>(resolve => {sawText = resolve})
  const adapter: AgentAdapter = {capability: real.capability, discover: input => real.discover(input), async start(input, emit) {
    observedSession = await real.start(input, async event => {await emit(event); if (event.type === 'text_checkpoint') sawText()})
    return observedSession
  }}
  const events: AgentHostEvent[] = []
  const command: AgentHostCommand = {protocolVersion: 1, commandId: 'start', environmentId: 'env', workspaceId: 'workspace', runId: 'run', sequence: 1, issuedAt: Date.now(), type: 'start',
    payload: {bindingId: 'binding', adapterId: 'fixture', workingDirectory: directory, prompt: 'Continue until stopped', metadata: {}}}
  let polled = false, returned = false
  const runtime = new AgentHostRuntime({environmentId: 'env', workspaceId: 'workspace', filesystem: {mode: 'selected_roots', roots: [directory]}, adapters: [adapter], state,
    controlPlane: {
      async pollCommands({signal}) {
        if (!polled) {polled = true; return {commands: [command]}}
        await new Promise<void>(resolve => {if (signal?.aborted) resolve(); else signal?.addEventListener('abort', () => resolve(), {once: true})})
        return {commands: []}
      },
      async acknowledgeCommand() {},
      async uploadEvents(batch) {await uploadGate; events.push(...batch.events); return {protocolVersion: 1, accepted: true, acknowledgedSequence: batch.events.at(-1)!.sourceSequence}},
    },
  })
  const running = runtime.run(controller.signal)
  void running.then(() => {returned = true}, () => {returned = true})
  try {
    await Promise.race([textReady, new Promise<never>((_, reject) => {const timer = setTimeout(() => reject(Error('Provider did not start')), 10000); timer.unref()})])
    const pid = Number(await readFile(pidFile, 'utf8'))
    controller.abort()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(returned, false, 'run must not return while its upload still owns SQLite callbacks')
    releaseUpload()
    await running
    assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'}, 'the real child must have stopped before host exit')
    const retained = [...events, ...state.pendingUploadEvents(100)]
    assert.equal(retained.filter(event => event.type === 'text_checkpoint').at(-1)?.payload.text, 'Retain the unfinished answer 🙂\n')
    assert.ok(!retained.some(event => ['completed', 'failed', 'cancelled'].includes(event.type)), 'host interruption must not turn into a provider terminal outcome')
    assert.equal(runtime.canCloseState, true)
    state.close()
    await assert.rejects(runtime.processCommand(command), /shutdown is in progress/)
    await new Promise(resolve => setTimeout(resolve, 300))
    const reopened = new SqliteHostStateStore(statePath)
    try {assert.equal(reopened.getSession('run')?.remoteSessionId, 'pending-session')} finally {reopened.close()}
  } finally {
    controller.abort(); releaseUpload(); await running.catch(() => undefined); await observedSession?.stop()
    runtime.stopBackgroundUploads()
    await new Promise(resolve => setTimeout(resolve, 300))
    try {state.close()} catch { /* The successful path already closed it. */ }
    await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})
  }
})
