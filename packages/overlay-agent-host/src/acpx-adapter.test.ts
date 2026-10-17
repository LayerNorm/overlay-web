import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AcpxAgentAdapter, isAuthFailureMessage } from './acpx-adapter'
import type { NormalizedAgentEvent } from './adapter'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-agent.ts')
const fixtureLaunch = [process.execPath, '--import', import.meta.resolve('tsx'), fixture]

function fixtureAdapter(stateDirectory: string) {
  return new AcpxAgentAdapter({
    id: 'fixture-acpx', displayName: 'Fixture via acpx', agent: 'fixture', stateDirectory,
    registryOverrides: { fixture: fixtureLaunch },
  })
}

test('acpx adapter streams updates and bridges approval and elicitation like the direct adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-'))
  const workspace = join(directory, 'workspace')
  const log = join(directory, 'sessions.jsonl')
  await mkdir(workspace)
  const adapter = fixtureAdapter(join(directory, 'state'))
  const events: NormalizedAgentEvent[] = []
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  let nativePid: number | undefined
  let turnEndedBeforeDisconnect = false
  try {
    assert.equal((await adapter.discover()).id, 'fixture-acpx')
    session = await adapter.start({
      runId: 'run-acpx', workingDirectory: workspace, additionalDirectories: [], prompt: 'test', metadata: {},
      credentials: {FIXTURE_SESSION_LOG: log},
      onNativeTurnEnded() {
        const pid = nativePid
        assert.ok(pid)
        assert.doesNotThrow(() => process.kill(pid, 0), 'turn result must be announced before native cleanup')
        turnEndedBeforeDisconnect = true
      },
    }, async (event) => {
      if (event.type === 'completed') {
        assert.equal(turnEndedBeforeDisconnect, true, 'health probes must know the native turn ended before cleanup')
        const record = JSON.parse((await readFile(log, 'utf8')).trim())
        assert.throws(() => process.kill(record.pid, 0), {code: 'ESRCH'}, 'completion must follow native process closure')
      }
      events.push(event)
    })
    nativePid = JSON.parse((await readFile(log, 'utf8')).trim()).pid
    const prompt = session.prompt('test ACP via acpx')
    assert.equal(await session.observe?.(), 'live', 'dispatching the prepared prompt must not report unknown health')
    await waitFor(() => events.some((event) => event.type === 'approval_requested'))
    await session.approve('fixture-write', 'allow_once')
    await waitFor(() => events.some((event) => event.type === 'elicitation_requested'))
    const elicitation = events.find((event) => event.type === 'elicitation_requested')
    await session.elicit(String(elicitation?.payload.requestKey), 'accept', { label: 'approved fixture' })
    await prompt
    assert.ok(events.some((event) => event.type === 'text_checkpoint' && event.payload.text === 'ACP fixture output'))
    assert.ok(events.some((event) => event.type === 'action' && event.payload.status === 'completed'))
    assert.ok(events.some((event) => event.type === 'plan'))
    assert.ok(events.some((event) => event.type === 'diff'))
    assert.ok(events.some((event) => event.type === 'terminal'))
    assert.ok(events.some((event) => event.type === 'commands_update'))
    assert.equal(events.at(-1)?.type, 'completed')
  } finally {
    await session?.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('a later run resumes the same acpx session after the connection was closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-resume-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  const state = join(directory, 'state')
  const runOnce = async (remoteSessionId?: string) => {
    const adapter = fixtureAdapter(state)
    const events: NormalizedAgentEvent[] = []
    const session = await adapter.start({
      runId: 'run', workingDirectory: workspace, additionalDirectories: [], prompt: 'p', metadata: {},
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }, async (event) => {
      events.push(event)
      if (event.type === 'approval_requested') await session.approve(String(event.payload.requestKey), 'allow_once')
      if (event.type === 'elicitation_requested') await session.elicit(String(event.payload.requestKey), 'decline')
    })
    await session.prompt('again')
    await session.stop()
    return { remoteSessionId: session.remoteSessionId, events }
  }
  try {
    const first = await runOnce()
    const second = await runOnce(first.remoteSessionId)
    assert.equal(second.remoteSessionId, first.remoteSessionId)
    assert.equal(second.events.at(-1)?.type, 'completed')
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('a saved native identity loads the same ACP conversation when the acpx record is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-identity-'))
  const state = join(directory, 'state'), log = join(directory, 'sessions.jsonl')
  let checkpoint: Record<string, unknown> | undefined
  let session: Awaited<ReturnType<AcpxAgentAdapter['start']>> | undefined
  const events: NormalizedAgentEvent[] = []
  try {
    session = await fixtureAdapter(state).start({runId: 'identity', workingDirectory: directory,
      additionalDirectories: [], prompt: '', metadata: {}, credentials: {FIXTURE_SESSION_LOG: log, FIXTURE_SECRET: 'never-checkpoint-this'},
      persistAdapterState: async value => {checkpoint = value},
    }, async () => {})
    const remoteSessionId = session.remoteSessionId
    assert.ok(checkpoint)
    assert.doesNotMatch(JSON.stringify(checkpoint), /never-checkpoint-this|FIXTURE_SECRET|credentials/)
    await session.stop()
    session = undefined
    await rm(state, {recursive: true, force: true})
    session = await fixtureAdapter(state).start({runId: 'identity', remoteSessionId, workingDirectory: directory,
      additionalDirectories: [], prompt: '', metadata: {}, adapterState: checkpoint,
      credentials: {FIXTURE_SESSION_LOG: log}, persistAdapterState: async value => {checkpoint = value},
    }, async event => {
      events.push(event)
      if (event.type === 'approval_requested') await session?.approve(String(event.payload.requestKey), 'allow_once')
      if (event.type === 'elicitation_requested') await session?.elicit(String(event.payload.requestKey), 'decline')
    })
    await session.prompt('Continue the saved conversation')
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(records.map(record => record.operation), ['new', 'load'])
    assert.equal(records[1].sessionId, records[0].sessionId)
    assert.equal(checkpoint?.backendSessionId, records[0].sessionId)
    assert.equal(session.remoteSessionId, remoteSessionId)
    assert.equal(events.at(-1)?.type, 'completed')
  } finally {
    await session?.stop()
    await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})
  }
})

test('a missing identity or a mismatched checkpoint never starts a replacement conversation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-missing-identity-'))
  const log = join(directory, 'sessions.jsonl')
  try {
    for (const adapterState of [undefined, {version: 1, sessionKey: 'other', agent: 'fixture',
      workingDirectory: directory, backendSessionId: 'old-native'}]) {
      await assert.rejects(fixtureAdapter(join(directory, 'state')).start({runId: 'identity', remoteSessionId: 'saved-key',
        workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: {}, adapterState,
        credentials: {FIXTURE_SESSION_LOG: log},
      }, async () => {}), /session identity/)
    }
    await assert.rejects(readFile(log), {code: 'ENOENT'})
  } finally { await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}) }
})

test('a provider load failure never falls back to a fresh session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-load-refusal-'))
  const state = join(directory, 'state'), log = join(directory, 'sessions.jsonl')
  let checkpoint: Record<string, unknown> | undefined
  try {
    const first = await fixtureAdapter(state).start({runId: 'identity', workingDirectory: directory,
      additionalDirectories: [], prompt: '', metadata: {}, credentials: {FIXTURE_SESSION_LOG: log},
      persistAdapterState: async value => {checkpoint = value},
    }, async () => {})
    await first.stop()
    await rm(state, {recursive: true, force: true})
    await assert.rejects(fixtureAdapter(state).start({runId: 'identity', remoteSessionId: first.remoteSessionId,
      workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: {}, adapterState: checkpoint,
      credentials: {FIXTURE_SESSION_LOG: log, FIXTURE_REJECT_SESSION_LOAD: '1'},
    }, async () => {}), /load rejected|session.*failed/i)
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(records.map(record => record.operation), ['new', 'load'])
    assert.equal(records[1].sessionId, records[0].sessionId)
  } finally { await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}) }
})

test('checkpoint persistence failure closes the new native process before returning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-checkpoint-failure-'))
  const log = join(directory, 'sessions.jsonl')
  try {
    await assert.rejects(fixtureAdapter(join(directory, 'state')).start({runId: 'identity', workingDirectory: directory,
      additionalDirectories: [], prompt: '', metadata: {}, credentials: {FIXTURE_SESSION_LOG: log},
      persistAdapterState: async () => {throw Error('private checkpoint unavailable')},
    }, async () => {}), /private checkpoint unavailable/)
    const record = JSON.parse((await readFile(log, 'utf8')).trim())
    await waitFor(() => {
      try {process.kill(record.pid, 0); return false}
      catch (error) {return error instanceof Error && 'code' in error && error.code === 'ESRCH'}
    })
  } finally { await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}) }
})

test('configuration failure closes the native process without publishing a session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-config-failure-'))
  const log = join(directory, 'sessions.jsonl')
  try {
    await assert.rejects(fixtureAdapter(join(directory, 'state')).start({runId: 'config-failure',
      workingDirectory: directory, additionalDirectories: [], prompt: '', metadata: {model: 'not-offered'},
      credentials: {FIXTURE_SESSION_LOG: log},
    }, async () => {}))
    const record = JSON.parse((await readFile(log, 'utf8')).trim())
    await waitFor(() => {
      try {process.kill(record.pid, 0); return false}
      catch (error) {return error instanceof Error && 'code' in error && error.code === 'ESRCH'}
    })
  } finally { await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}) }
})

test('an unconfirmed acpx close rejects Stop and further prompts, and Stop can retry after storage recovers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-close-failure-'))
  const state = join(directory, 'state'), records = join(state, 'acpx'), backup = join(state, 'acpx-backup')
  const log = join(directory, 'sessions.jsonl')
  let session: Awaited<ReturnType<AcpxAgentAdapter['start']>> | undefined
  let unavailable = false
  try {
    session = await fixtureAdapter(state).start({runId: 'close-failure', workingDirectory: directory,
      additionalDirectories: [], prompt: '', metadata: {}, credentials: {FIXTURE_SESSION_LOG: log},
    }, async () => {})
    const record = JSON.parse((await readFile(log, 'utf8')).trim())
    process.kill(record.pid, 0)
    await rename(records, backup)
    await writeFile(records, 'storage unavailable')
    unavailable = true
    await assert.rejects(session.stop(), /ENOTDIR|EEXIST/)
    await assert.rejects(session.prompt('Must not start a new writer'), /closure is unconfirmed/)
    await rm(records)
    await rename(backup, records)
    unavailable = false
    await session.stop()
    await waitFor(() => {
      try {process.kill(record.pid, 0); return false}
      catch (error) {return error instanceof Error && 'code' in error && error.code === 'ESRCH'}
    })
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1, 'failed closure must not create a replacement process')
  } finally {
    if (unavailable) { await rm(records, {force: true}); await rename(backup, records) }
    await session?.stop()
    await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})
  }
})

test('discovery rejects agents acpx does not know', async () => {
  const adapter = new AcpxAgentAdapter({ id: 'nope', displayName: 'Nope', agent: 'definitely-not-an-agent', stateDirectory: tmpdir() })
  await assert.rejects(adapter.discover(), /does not know/)
})

test('acpx applies live model, effort and cloud mode before every prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-options-'))
  const log = join(directory, 'options.jsonl')
  const agentFixture = join(dirname(fixture), 'acp-options-agent.ts')
  const adapter = new AcpxAgentAdapter({
    id: 'fixture', displayName: 'Options fixture', agent: 'fixture', stateDirectory: join(directory, 'state'),
    registryOverrides: { fixture: [process.execPath, '--import', import.meta.resolve('tsx'), agentFixture] },
  })
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    const discovered = await adapter.discover({ workingDirectory: directory, credentials: { FIXTURE_OPTIONS_LOG: log } })
    assert.equal(discovered.options?.model?.values[1]?.id, 'future-model')
    assert.deepEqual(await readdir(directory), [])
    session = await adapter.start({ runId: 'options', workingDirectory: directory, additionalDirectories: [], prompt: '',
      credentials: { FIXTURE_OPTIONS_LOG: log },
      metadata: { model: 'future-model', effort: 'high', permissionContext: 'cloud' },
    }, async () => {})
    const prepared = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(prepared.filter(record => record.kind === 'selection').map(({id, value}) => ({id, value})), [
      { id: 'provider-model', value: 'future-model' },
      { id: 'provider-effort', value: 'high' },
      { id: 'permissions', value: 'auto' },
    ], 'start must apply the selected options before publishing a session to host heartbeats')
    await session.prompt('first')
    await session.prompt('second')
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const prompts = records.filter(record => record.kind === 'prompt')
    assert.equal(prompts.length, 2)
    for (const prompt of prompts) assert.deepEqual(prompt.values, [
      { id: 'provider-model', value: 'future-model' },
      { id: 'provider-effort', value: 'high' },
      { id: 'permissions', value: 'auto' },
    ])
    assert.equal(adapter.capability.options?.model?.values[1]?.id, 'future-model')
  } finally {
    await session?.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for ACP event')
}

test('per-run credentials reach the agent process and are not kept on the adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acpx-env-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  const adapter = fixtureAdapter(join(directory, 'state'))
  const events: NormalizedAgentEvent[] = []
  try {
    const session = await adapter.start({
      runId: 'run', workingDirectory: workspace, additionalDirectories: [], prompt: 'p', metadata: {},
      credentials: { FIXTURE_SECRET: 'run-secret-1' },
    }, async (event) => {
      events.push(event)
      if (event.type === 'approval_requested') await session.approve(String(event.payload.requestKey), 'allow_once')
      if (event.type === 'elicitation_requested') await session.elicit(String(event.payload.requestKey), 'decline')
    })
    await session.prompt('again')
    await session.stop()
    const text = events.filter((event) => event.type === 'text_checkpoint').map((event) => String(event.payload.text)).join('|')
    assert.match(text, /\[secret=run-secret-1\]/)
    // A later run without credentials sees none: nothing is cached across runs.
    const second = await fixtureAdapter(join(directory, 'state')).start({
      runId: 'run-2', workingDirectory: workspace, additionalDirectories: [], prompt: 'p', metadata: {},
    }, async (event) => {
      events.push(event)
      if (event.type === 'approval_requested') await second.approve(String(event.payload.requestKey), 'allow_once')
      if (event.type === 'elicitation_requested') await second.elicit(String(event.payload.requestKey), 'decline')
    })
    await second.prompt('again')
    await second.stop()
    assert.match(events.filter((event) => event.type === 'text_checkpoint').map((event) => String(event.payload.text)).join('|'), /\[secret=none\]/)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('sign-in failures are recognised, and ordinary failures are not', () => {
  for (const message of ['Authentication required', 'Not logged in · Please run /login', 'Invalid API key', 'OAuth token has expired (401)', 'unauthorized']) {
    assert.equal(isAuthFailureMessage(message), true, message)
  }
  for (const message of ['Rate limit exceeded', 'Credit balance is too low', 'Tool call failed: ENOENT', 'Model overloaded']) {
    assert.equal(isAuthFailureMessage(message), false, message)
  }
})


test('acpx advertises fenced restoration only for an explicitly opted-in adapter', async () => {
  for (const enabled of [undefined, false, true]) {
    const adapter = new AcpxAgentAdapter({id: 'native', displayName: 'Native', agent: 'codex', stateDirectory: tmpdir(),
      ...(enabled === undefined ? {} : {fencedSessionRestoration: enabled})})
    const capability = await adapter.discover()
    assert.equal(capability.recovery?.fencedSessionRestoration, enabled === true ? true : undefined)
    assert.equal(capability.recovery?.interruptedTurnContinuation, false)
    assert.equal(capability.recovery?.approvalRestoration, false)
  }
})
