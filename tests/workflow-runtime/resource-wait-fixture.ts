import type { HarnessResourceWaitPorts } from '../../src/server/harness/resource-waits'
import { waitForHarnessResources } from '../../src/server/harness/resource-waits'

async function directory(id: string): Promise<string> {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid resource fixture ID.')
  return join(tmpdir(), 'overlay-resource-workflow-tests', id)
}

async function appendEvent(id: string, event: string): Promise<void> {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(`${await directory(id)}/events`, `${event}\n`)
}

export async function readResourceFixture(id: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  return (await readFile(`${await directory(id)}/events`, 'utf8')).trim().split('\n')
}

export async function grantResourceFixture(id: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(`${await directory(id)}/grant`, 'committed')
}

async function completedStep(id: string): Promise<void> {
  'use step'
  const { mkdir } = await import('node:fs/promises')
  await mkdir(await directory(id), { recursive: true })
  await appendEvent(id, 'completed-step')
}

async function publishResourceFixture(id: string): ReturnType<HarnessResourceWaitPorts['publish']> {
  'use step'
  await appendEvent(id, 'published')
  return 'paused'
}

async function consumeResourceFixture(id: string): ReturnType<HarnessResourceWaitPorts['consume']> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  let granted = false
  try {
    granted = await readFile(`${await directory(id)}/grant`, 'utf8') === 'committed'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await appendEvent(id, granted ? 'consumed' : 'pending')
  return granted ? 'consumed' : 'pending'
}

export async function resourceWaitFixture(input: { id: string }) {
  'use workflow'
  await completedStep(input.id)
  return waitForHarnessResources({
    actorUserId: 'fixture', runId: input.id, workflowRunId: 'fixture', token: `resource:${input.id}`,
    expectedRevision: 1, reason: 'time', requiredCostMicros: 0,
  }, {
    publish: () => publishResourceFixture(input.id),
    consume: () => consumeResourceFixture(input.id),
  })
}
