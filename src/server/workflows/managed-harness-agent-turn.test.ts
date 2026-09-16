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

test('tool policy: env-configurable permission mode, no elicitation tool', async () => {
  const steps = await read('src/server/agents/managed-harness-steps.ts')
  assert.match(steps, /OVERLAY_MANAGED_HARNESS_PERMISSION_MODE/)
  assert.match(steps, /permissionMode: managedHarnessPermissionMode\(\)/)
  assert.match(steps, /inactiveTools: \['askUserQuestions'\]/)
})

test('sandbox settlement never fails a finalized or abandoned turn', async () => {
  const steps = await read('src/server/agents/managed-harness-steps.ts')
  const finalize = steps.slice(
    steps.indexOf('export async function finalizeManagedHarnessTurn'),
    steps.indexOf('export async function failManagedHarnessTurn'),
  )
  // A dead sandbox or repointed lease makes settle throw — but the reply is
  // already persisted by then, so every call site must swallow the error and
  // let the reservation's reconcile path recover the cents.
  for (const match of finalize.matchAll(/settleManagedHarnessSandbox\([^)]*\)\s*(\.catch)?/g)) {
    assert.ok(match[1], `settle call in finalizeManagedHarnessTurn must be .catch-guarded: ${match[0]}`)
  }
  assert.ok(finalize.includes('settleManagedHarnessSandbox'), 'expected a settle call in finalize')
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

/**
 * Phase 3 wiring — the picker-selected model and the agent's instructions
 * must reach the HarnessAgent, and dispatch must re-check availability so a
 * retired runtime cannot keep turning on an existing binding.
 */
test('dispatch re-gates availability and threads harness model + instructions', async () => {
  const [invocation, workflow, steps] = await Promise.all([
    read('src/server/agents/workspace-agent-invocation.ts'),
    read('src/server/workflows/managed-harness-agent-turn.ts'),
    read('src/server/agents/managed-harness-steps.ts'),
  ])
  const dispatch = invocation.slice(invocation.indexOf('export async function startManagedHarnessTurn'))
  assert.match(dispatch, /managedHarnessAvailability\(/)
  assert.match(dispatch, /managedHarnessModelOption\(/)
  assert.match(dispatch, /harnessModel/)
  assert.match(dispatch, /instructions/)
  assert.match(workflow, /harnessModel: input\.harnessModel/)
  assert.match(workflow, /instructions: input\.instructions/)
  assert.match(steps, /model: input\.harnessModel/)
  assert.match(steps, /instructions: input\.instructions/)
})

test('managed route serves the gated picker and enforces availability on POST', async () => {
  const route = await read('src/server/app-api/v1/agent-environments/managed/route.ts')
  assert.match(route, /export async function GET/)
  // Both GET and POST consult the same availability helper — no divergence.
  assert.equal((route.match(/managedHarnessAvailability\(/g) ?? []).length, 2)
  assert.match(route, /availability\.harnesses\.some/)
  assert.match(route, /managedHarnessSandboxProviders\(\)\.includes/)
})

test('the editor reset path is a dedicated endpoint on the control plane', async () => {
  const [route, controlPlane] = await Promise.all([
    read('src/server/app-api/v1/agent-environments/[environmentId]/reset-harness/route.ts'),
    read('src/server/agents/ConnectedAgentControlPlaneService.ts'),
  ])
  assert.match(route, /resetHarnessEnvironment\(/)
  // Reset clears durable sessions and destroys the sandbox — never touches
  // the lease row the next turn recreates from.
  const reset = controlPlane.slice(controlPlane.indexOf('async resetHarnessEnvironment'))
  assert.match(reset, /deleteHarnessSessionsForBinding/)
  assert.match(reset, /reconnect\(lease\.providerReference\)/)
  assert.match(reset, /agent_environment\.harness_reset/)
})

/**
 * Phase 4 wiring — providers, approvals, and BYOK
 * (docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md).
 */
test('awaiting_tool_approval parks the run on a durable hook the approval route resolves', async () => {
  const [workflow, steps] = await Promise.all([
    read('src/server/workflows/managed-harness-agent-turn.ts'),
    read('src/server/agents/managed-harness-steps.ts'),
  ])
  // The unified loop re-enters the slice path after an approval resolves —
  // a resolved turn lands back on ready_for_next_step, not straight to done.
  assert.match(workflow, /state\.status === 'ready_for_next_step' \|\| state\.status === 'awaiting_tool_approval'/)
  assert.match(workflow, /createHook<\{ approved: boolean; reason\?: string \}>/)
  assert.match(workflow, /markManagedHarnessApprovalWaiting/)
  assert.match(workflow, /markManagedHarnessApprovalResolved/)
  assert.match(workflow, /MAX_MANAGED_HARNESS_APPROVAL_CYCLES/)
  assert.match(workflow, /harnessApprovalContinuationMessages\(pending, decision\)/)
  // Approval state lands on the run row — the shared card + route drive it.
  assert.match(steps, /agentRunService\.waitForApproval/)
  assert.match(steps, /agentRunService\.resumeAfterApproval/)
})

test('non-Vercel providers reach the harness through the Overlay sandbox bridge', async () => {
  const [steps, providers] = await Promise.all([
    read('src/server/agents/managed-harness-steps.ts'),
    read('src/server/agents/harnesses/sandbox-providers.ts'),
  ])
  assert.match(steps, /createOverlayHarnessInstanceProvider/)
  assert.match(providers, /createOverlayHarnessSandboxProvider/)
  // Daytona is selectable; Box is refused loudly rather than offered insecurely.
  assert.match(providers, /daytonaHarnessCredentialsConfigured/)
  assert.match(providers, /Box is not offered for managed harnesses/)
})

test('BYOK threads the connection id to the slice, which resolves the key at run time', async () => {
  const [invocation, workflow, steps, registry, controlPlane, bindingsRoute] = await Promise.all([
    read('src/server/agents/workspace-agent-invocation.ts'),
    read('src/server/workflows/managed-harness-agent-turn.ts'),
    read('src/server/agents/managed-harness-steps.ts'),
    read('src/server/agents/harnesses/registry.ts'),
    read('src/server/agents/ConnectedAgentControlPlaneService.ts'),
    read('src/server/app-api/v1/agent-bindings/route.ts'),
  ])
  assert.match(invocation, /adapterConfig\.byokConnectionId/)
  assert.match(invocation, /byokConnectionId: remoteTarget\.byokConnectionId/)
  assert.match(workflow, /byokConnectionId: input\.byokConnectionId/)
  assert.match(steps, /resolveManagedHarnessAuthentication/)
  assert.match(steps, /byokCredentialStore\.read/)
  // The adapter receives the env record at construction — nothing is persisted.
  assert.match(registry, /loadAdapter: \(authentication\?/)
  assert.match(registry, /loadHarnessAdapter\(args\.harnessId, args\.authentication\)/)
  // The control plane validates ownership, compatibility, and the provider.
  const billing = controlPlane.slice(controlPlane.indexOf('private async harnessBillingConfig'))
  assert.match(billing, /lease\?\.provider !== 'vercel'/)
  assert.match(billing, /providerConnections\.get/)
  assert.match(bindingsRoute, /modelBilling/)
  assert.match(bindingsRoute, /byokConnectionId/)
})
