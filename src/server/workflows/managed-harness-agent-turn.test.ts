import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = process.cwd()

const read = (path: string) => readFile(`${root}/${path}`, 'utf8')

/**
 * Phase 2 wiring of docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md — these are
 * structural checks: the durable path is exercised end-to-end by the live exit
 * gate, while these assertions keep the dispatch/workflow contract from
 * drifting (e.g. a harness binding silently reaching the ACP command queue).
 */
test('message route branches harness bindings to the managed harness dispatch', async () => {
  const [route, invocation] = await Promise.all([
    read('src/server/app-api/v1/conversations/message/route.ts'),
    read('src/server/agents/workspace-agent-invocation.ts'),
  ])
  assert.match(route, /protocolAdapter === 'harness'/)
  assert.match(route, /startManagedHarnessTurn\(/)
  assert.match(invocation, /start\(managedHarnessAgentTurnWorkflow/)
  // The run row + reply row come from the collaboration store, not the
  // connected-agent command queue.
  assert.match(invocation, /collaboration\.startAgentTurn\(/)
  const harnessDispatch = invocation.slice(invocation.indexOf('export async function startManagedHarnessTurn'))
  assert.doesNotMatch(harnessDispatch, /startRemoteAgentTurn/)
})

test('the managed harness turn is a durable workflow of replayable steps', async () => {
  const [workflow, steps] = await Promise.all([
    read('src/server/workflows/managed-harness-agent-turn.ts'),
    read('src/server/agents/managed-harness-steps.ts'),
  ])
  assert.match(workflow, /'use workflow'/)
  assert.match(workflow, /attachWorkspaceAgentRun/)
  assert.match(workflow, /acquireManagedHarnessTurn/)
  assert.match(workflow, /runManagedHarnessTurnSlice/)
  assert.match(workflow, /finalizeManagedHarnessTurn/)
  assert.match(workflow, /failManagedHarnessTurn/)
  assert.match(workflow, /completeWorkspaceAgentRun/)
  assert.match(workflow, /abandonWorkspaceAgentRun/)
  // The slice loop is bounded by the dispatch-computed ceiling.
  assert.match(workflow, /maxTurnSlices/)
  for (const step of [
    'acquireManagedHarnessTurn',
    'runManagedHarnessTurnSlice',
    'finalizeManagedHarnessTurn',
    'failManagedHarnessTurn',
  ]) {
    const at = steps.indexOf(`export async function ${step}`)
    assert.notEqual(at, -1, `${step} must exist`)
    assert.match(steps.slice(at, at + 1600), /\n\s*'use step'/, `${step} must be a durable step`)
  }
  // Workflow bundles cannot carry Node built-ins or the harness graph — all
  // @ai-sdk imports in the steps module must be dynamic.
  assert.doesNotMatch(workflow, /from '@ai-sdk\//)
  assert.doesNotMatch(workflow, /import 'node:/)
  assert.doesNotMatch(steps, /import\s+[^'"]*from '@ai-sdk\//)
})

test('slice step wraps the reconnected native handle and persists resume state', async () => {
  const steps = await read('src/server/agents/managed-harness-steps.ts')
  // Provider wrap happens on the reconnected native handle, per plan.
  assert.match(steps, /rawProviderDiagnosticHandle\(\)/)
  assert.match(steps, /createVercelSandbox\(\{ sandbox: native/)
  // Stale leases are recreated and the lease's providerReference updated.
  assert.match(steps, /updateSandboxLease\(/)
  assert.match(steps, /providerReference: instance\.reference/)
  // resumeFrom is read from and written to agentHarnessSessions.
  assert.match(steps, /getHarnessSession\(/)
  assert.match(steps, /upsertHarnessSession\(/)
  assert.match(steps, /resumeState/)
  // Buffered transcript text is drained before the step returns.
  assert.match(steps, /stream\.flush\(\)/)
})

test('v1 tool policy: sandbox-boundary permissions, no elicitation tool', async () => {
  const steps = await read('src/server/agents/managed-harness-steps.ts')
  assert.match(steps, /permissionMode: 'allow-all'/)
  assert.match(steps, /inactiveTools: \['askUserQuestions'\]/)
  // Interactive approvals remain a follow-up — the workflow fails that state
  // loudly rather than parking the turn.
  const workflow = await read('src/server/workflows/managed-harness-agent-turn.ts')
  assert.match(workflow, /awaiting_tool_approval/)
})

test('failure path destroys the session, releases the reservation, settles billing', async () => {
  const steps = await read('src/server/agents/managed-harness-steps.ts')
  const fail = steps.slice(steps.indexOf('export async function failManagedHarnessTurn'))
  assert.match(fail, /destroyManagedHarnessSessionHandle/)
  assert.match(fail, /session\.destroy\(\)/)
  assert.match(fail, /releaseReservation/)
  assert.match(fail, /settleManagedHarnessSandbox/)
  assert.match(fail, /failAgentMessage/)
  assert.match(fail, /agentRunService\.fail/)
})
