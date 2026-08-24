import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AcpAgentAdapter } from './acp-adapter'
import type { NormalizedAgentEvent } from './adapter'

test('official ACP SDK adapter streams updates and bridges approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlay-acp-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acp-agent.ts')
  const adapter = new AcpAgentAdapter({
    id: 'fixture-acp', displayName: 'Fixture ACP', command: process.execPath,
    args: ['--import', import.meta.resolve('tsx'), fixture],
  })
  const events: NormalizedAgentEvent[] = []
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    session = await adapter.start({
      runId: 'run-acp', workingDirectory: workspace, additionalDirectories: [],
      prompt: 'test', metadata: {},
    }, async (event) => { events.push(event) })
    const prompt = session.prompt('test ACP')
    await waitFor(() => events.some((event) => event.type === 'approval_requested'))
    await session.approve('fixture-write', 'allow_once')
    await prompt
    assert.ok(events.some((event) => event.type === 'text_checkpoint' && event.payload.text === 'ACP fixture output'))
    assert.ok(events.some((event) => event.type === 'action' && event.payload.status === 'completed'))
    assert.ok(events.some((event) => event.type === 'completed'))
  } finally {
    await session?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for ACP event')
}
