import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
  await mkdir(workspace)
  const adapter = fixtureAdapter(join(directory, 'state'))
  const events: NormalizedAgentEvent[] = []
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    assert.equal((await adapter.discover()).id, 'fixture-acpx')
    session = await adapter.start({
      runId: 'run-acpx', workingDirectory: workspace, additionalDirectories: [], prompt: 'test', metadata: {},
    }, async (event) => { events.push(event) })
    const prompt = session.prompt('test ACP via acpx')
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

test('discovery rejects agents acpx does not know', async () => {
  const adapter = new AcpxAgentAdapter({ id: 'nope', displayName: 'Nope', agent: 'definitely-not-an-agent', stateDirectory: tmpdir() })
  await assert.rejects(adapter.discover(), /does not know/)
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
