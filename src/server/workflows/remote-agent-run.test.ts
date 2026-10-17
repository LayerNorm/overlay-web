import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Script } from 'node:vm'
import ts from 'typescript'

// Exercise the actual coordinator loop with its SDK/step boundaries replaced.
// The installed SDK's registration/replay contracts have separate runtime tests.
async function exercise(phases: string[]) {
  const calls = { stop: 0, sleep: 0, disposed: 0 }
  const exports: Record<string, (input: { runId: string; generation: number }) => Promise<void>> = {}
  const steps = {
    claimRemoteRunCoordinator: async () => true,
    wakeRemoteRun: async () => undefined,
    advanceRemoteRun: async () => ({ phase: phases.shift() ?? 'cancelled' }),
    readRemoteRun: async () => ({ lifecycle: { coordinatorId: 'owner' } }),
    stopUnreachableRemoteRun: async (runId: string) => {
      assert.equal(runId, 'run')
      calls.stop++
    },
  }
  const sdk = {
    getWorkflowMetadata: () => ({ workflowRunId: 'owner' }),
    createHook: () => ({
      getConflict: async () => false,
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      [Symbol.dispose]: () => { calls.disposed++ },
    }),
    sleep: async () => { calls.sleep++ },
  }
  const source = readFileSync(new URL('./remote-agent-run.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Script(compiled).runInNewContext({
    exports, Symbol,
    require: (id: string) => {
      if (id === 'workflow') return sdk
      assert.equal(id, '@/server/agents/remote-agent-run-lifecycle')
      return steps
    },
  })
  await exports.remoteAgentRunWorkflow({ runId: 'run', generation: 1 })
  return calls
}

test('cancellation retries stop proof on timer passes after all notifications are consumed', async () => {
  assert.deepEqual(await exercise(['cancelling', 'cancelling', 'cancelled']), {
    stop: 2, sleep: 2, disposed: 1,
  })
})

test('ordinary and terminal phases never invoke cancellation stop proof', async () => {
  assert.deepEqual(await exercise(['starting', 'running', 'completed']), {
    stop: 0, sleep: 2, disposed: 1,
  })
})
