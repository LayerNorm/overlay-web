import { createHook } from 'workflow'
import { createHarnessWaitPorts } from '../../src/server/harness/waits'
import {
  createHarnessSnapshot, pauseHarnessForFunding, resumeHarnessFunding, type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'

async function directory(id: string): Promise<string> {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid funding fixture ID.')
  return join(tmpdir(), 'overlay-harness-funding-workflow-tests', id)
}

export async function initializeHarnessFundingFixture(id: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const path = await directory(id)
  await mkdir(path, { recursive: true })
  const now = Date.now()
  const initial = createHarnessSnapshot({
    runId: id,
    goal: 'Finish the same funded task.',
    constraints: [],
    policy: {
      actorUserId: 'fixture',
      workspaceId: 'workspace',
      allowedToolIds: [],
      requiresPlan: false,
      maxCostMicros: 0,
      deadlineAt: now + 60_000,
      executionPolicyVersion: 2,
      spendingMode: 'workspace',
      maxDepth: 2,
      maxParallelChildren: 2,
    },
  }, now)
  const running = { ...initial, workflowRunId: 'fixture' }
  const paused = pauseHarnessForFunding(running, {
    reason: 'insufficient_budget',
    requiredCents: 25,
    availableCents: 0,
    reservedCents: 0,
    receiptId: 'model:4',
  }, now)
  paused.policy.deadlineAt = now - 1
  await writeFile(`${path}/state.json`, JSON.stringify(paused))
}

export async function grantHarnessFundingFixture(id: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(`${await directory(id)}/funded`, 'confirmed')
}

export async function readHarnessFundingFixture(id: string): Promise<HarnessSnapshot> {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(`${await directory(id)}/state.json`, 'utf8')) as HarnessSnapshot
}

export async function readHarnessFundingEvents(id: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  const events = await readFile(`${await directory(id)}/events`, 'utf8')
  return events.trim().split('\n')
}

async function readFundingState(id: string): Promise<HarnessSnapshot> {
  'use step'
  return readHarnessFundingFixture(id)
}

async function recordFundingLeaseRenewal(id: string): Promise<void> {
  'use step'
  const { appendFile, writeFile } = await import('node:fs/promises')
  const path = await directory(id)
  const state = await readHarnessFundingFixture(id)
  state.policy.deadlineAt = Date.now() + 24 * 60 * 60 * 1_000
  await writeFile(`${path}/state.json`, JSON.stringify(state))
  await appendFile(`${path}/events`, 'lease-renewed\n')
}

async function checkFunding(id: string): Promise<boolean> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  try {
    return await readFile(`${await directory(id)}/funded`, 'utf8') === 'confirmed'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function persistFundingResume(id: string, state: HarnessSnapshot): Promise<void> {
  'use step'
  const { writeFile } = await import('node:fs/promises')
  await writeFile(`${await directory(id)}/state.json`, JSON.stringify(state))
}

export async function harnessFundingFixture(input: { id: string }) {
  'use workflow'
  const token = `harness-funding:${input.id}`
  using wake = createHook<unknown>({ token })
  if (await wake.getConflict()) throw new Error('Funding wake hook is already owned.')
  const reference = { actorUserId: 'fixture', runId: input.id, workflowRunId: 'fixture' }
  const ports = createHarnessWaitPorts({
    reference,
    renewLease: () => recordFundingLeaseRenewal(input.id),
    checkFunding: () => checkFunding(input.id),
    projectWait: async () => 'projected',
    wake: wake[Symbol.asyncIterator](),
    readState: () => readFundingState(input.id),
  })
  if (!ports.checkFunding || !ports.waitForFunding) throw new Error('Funding wait ports are unavailable.')
  while (!await ports.checkFunding(25)) await ports.waitForFunding()
  const state = await readFundingState(input.id)
  const resumed = resumeHarnessFunding(state, Date.now())
  await persistFundingResume(input.id, resumed)
  return { runId: resumed.runId, receiptId: state.resourcePause?.receiptId, status: resumed.status }
}
