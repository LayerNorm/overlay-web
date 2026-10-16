import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Script} from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import type {RemoteRunSnapshot} from './remote-agent-run-lifecycle'

const observedAt = Date.now()
function snapshot(): RemoteRunSnapshot {
  return {runId: 'run', workspaceId: 'workspace', environmentId: 'environment', environmentKind: 'overlay_cloud',
    nativeRestorationAdvertised: true, lifecycle: {version: 2, revision: 8, phase: 'needs_attention', cause: 'process_lost',
      currentAttemptId: 'attempt', executionGeneration: 1, coordinatorGeneration: 2, coordinatorId: 'owner',
      hardDeadlineAt: observedAt + 3_600_000, claimDeadlineAt: observedAt + 120_000}}
}

// Execute the actual step with only the database and physical provider boundaries replaced.
async function exercise(current: RemoteRunSnapshot | null, options: {record?: boolean; begin?: boolean; live?: boolean} = {}) {
  const calls: Array<{operation: string; args: Record<string, unknown>}> = []
  let inspected = 0, resumed = false
  const exports: Record<string, (input: {runId: string; coordinatorId: string; generation: number}) => Promise<void>> = {}
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    '@/server/shared/internal-api-secret': {getInternalApiSecret: () => 'test-secret'},
    '@/server/database/lazy-convex': {lazyConvex: {
      query: async () => current,
      mutation: async (operation: string, args: Record<string, unknown>) => {
        calls.push({operation, args: structuredClone(args)})
        return operation.endsWith('recordProviderStopByServer') ? options.record !== false : options.begin !== false
      },
    }},
    './cloud/create-cloud-agent-machine-service': {createCloudAgentMachineService: () => ({
      resumeStoppedExecution: async (args: {workspaceId: string; environmentId: string;
        authorize: (proof: {leaseId: string; providerReference: string; observedAt: number}) => Promise<boolean>}) => {
        inspected++
        assert.equal(args.workspaceId, 'workspace'); assert.equal(args.environmentId, 'environment')
        if (options.live) return 'unavailable'
        resumed = await args.authorize({leaseId: 'lease', providerReference: 'machine', observedAt})
        return resumed ? 'resumed' : 'unavailable'
      },
    })},
  }
  const source = readFileSync(new URL('./remote-agent-run-lifecycle.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  new Script(compiled).runInNewContext({exports, Date, require: (id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`)
    return dependencies[id]
  }})
  await exports.restoreStoppedRemoteRun({runId: 'run', coordinatorId: 'owner', generation: 2})
  return {calls, inspected, resumed}
}

test('stopped-machine continuation persists its exact proof then queues under the next revision before resume', async () => {
  const result = await exercise(snapshot())
  assert.equal(result.resumed, true)
  assert.equal(result.inspected, 1)
  assert.deepEqual(result.calls.map(call => call.operation), ['agents/remoteRuns:recordProviderStopByServer', 'agents/nativeRecovery:beginByServer'])
  assert.deepEqual(result.calls[0].args, {serverSecret: 'test-secret', runId: 'run', environmentId: 'environment',
    attemptId: 'attempt', generation: 1, expectedRevision: 8, leaseId: 'lease', providerReference: 'machine', now: observedAt})
  const queued = result.calls[1].args
  assert.equal(queued.expectedRevision, 9)
  assert.equal(queued.coordinatorId, 'owner'); assert.equal(queued.coordinatorGeneration, 2)
  assert.equal(queued.attemptId, 'attempt'); assert.equal(queued.generation, 1)
  assert.equal(queued.leaseId, 'lease'); assert.equal(queued.providerReference, 'machine')
})

test('missing capability, changed coordinator, cancelled or expired run never inspects or resumes a machine', async () => {
  const original = snapshot()
  const cases = [null, {...original, nativeRestorationAdvertised: false}, {...original, environmentKind: 'local'},
    ...[{coordinatorId: 'other'}, {coordinatorGeneration: 3}, {phase: 'cancelled' as const},
      {hardDeadlineAt: observedAt - 1}, {cause: 'approval_context_lost'}].map(change => ({...original, lifecycle: {...original.lifecycle, ...change}}))]
  for (const current of cases) assert.deepEqual(await exercise(current), {calls: [], inspected: 0, resumed: false})
})

test('live work and rejected proof or queue authorization cannot trigger a resume', async () => {
  const live = await exercise(snapshot(), {live: true})
  assert.deepEqual(live, {calls: [], inspected: 1, resumed: false})
  const rejected = await exercise(snapshot(), {record: false})
  assert.equal(rejected.resumed, false); assert.equal(rejected.calls.length, 1)
  const refused = await exercise(snapshot(), {begin: false})
  assert.equal(refused.resumed, false); assert.equal(refused.calls.length, 2)
})

test('a replay after durable queueing reauthorizes the original receipt without recording a new source generation', async () => {
  const current = snapshot()
  current.lifecycle = {...current.lifecycle, phase: 'recovering', cause: 'native_restoration', revision: 10,
    currentAttemptId: 'next-attempt', executionGeneration: 2, providerStop: {provider: 'box', environmentId: 'environment',
      attemptId: 'attempt', executionGeneration: 1, leaseId: 'lease', providerReference: 'machine', observedAt, recordedAtRevision: 8}}
  const result = await exercise(current)
  assert.equal(result.resumed, true); assert.equal(result.calls.length, 1)
  assert.equal(result.calls[0].operation, 'agents/nativeRecovery:beginByServer')
  assert.equal(result.calls[0].args.attemptId, 'attempt'); assert.equal(result.calls[0].args.generation, 1)
  assert.equal(result.calls[0].args.expectedRevision, 9)
})
