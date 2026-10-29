import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { applySwcTransform } from '@workflow/builders'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { transform } from 'esbuild'
import { expect, test, vi } from 'vitest'
import type { HarnessLanguageModel } from './secure-model'

test.each([
  ['model-preparation.ts', ['preparePersonalHarnessModel', 'readHarnessModelLimits']],
  ['native-model-preparation.ts', ['prepareNativeHarnessModel']],
  ['native-tool-steps.ts', ['nativeHarnessToolNeedsApproval', 'executeNativeHarnessTool', 'dispatchNativeHarnessAgentRequest']],
  ['native-named-child-launch.ts', ['startNativeHarnessNamedChild']],
  ['native-child-steps.ts', ['admitNativeHarnessChild']],
  ['native-delivery-steps.ts', ['writeNativeHarnessFallback', 'attachNativeHarnessDelivery',
    'projectNativeHarnessWait', 'finishNativeHarnessDelivery']],
] as const)('compiled %s exposes only durable server steps', async (filename, exports) => {
  const path = fileURLToPath(new URL(`./${filename}`, import.meta.url))
  const source = await readFile(path, 'utf8')
  const compiled = await applySwcTransform(`src/server/harness/${filename}`, source, 'workflow', path)
  const { code } = await transform(compiled.code, { format: 'cjs', target: 'es2022' })
  const compiledModule = { exports: {} as Record<string, (...args: unknown[]) => unknown> }
  const dispatch = vi.fn()
  runInNewContext(code, {
    module: compiledModule, exports: compiledModule.exports,
    require: (id: string) => { throw new Error(`Unexpected workflow import: ${id}`) },
    [Symbol.for('WORKFLOW_USE_STEP')]: (id: string) => (...args: unknown[]) => dispatch(id, ...args),
  })
  expect(Object.keys(compiledModule.exports).sort()).toEqual([...exports].sort())
  if (filename === 'native-tool-steps.ts') {
    const execute = compiledModule.exports.executeNativeHarnessTool as ((...args: unknown[]) => unknown) & { maxRetries?: number }
    expect(execute.maxRetries).toBe(0)
    const dispatch = compiledModule.exports.dispatchNativeHarnessAgentRequest as ((...args: unknown[]) => unknown) & { maxRetries?: number }
    expect(dispatch.maxRetries).toBe(0)
  }
  if (filename === 'native-named-child-launch.ts') {
    const launch = compiledModule.exports.startNativeHarnessNamedChild as ((...args: unknown[]) => unknown) & { maxRetries?: number }
    expect(launch.maxRetries).toBe(0)
  }
  for (const name of exports) {
    await compiledModule.exports[name]({ fixture: true })
    expect(dispatch).toHaveBeenLastCalledWith(expect.stringContaining(`//${name}`), { fixture: true })
  }
})

test('compiled native Harness workflow loads without runtime server dependencies', async () => {
  const path = fileURLToPath(new URL('../workflows/native-harness.ts', import.meta.url))
  const source = await readFile(path, 'utf8')
  const compiled = await applySwcTransform('src/server/workflows/native-harness.ts', source, 'workflow', path)
  const { code } = await transform(compiled.code, { format: 'cjs', target: 'es2022' })
  const compiledModule = { exports: {} as Record<string, unknown> }
  const imports: string[] = []
  runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    __private_workflows: new Map(),
    require: (id: string) => {
      imports.push(id)
      if (id === 'workflow') return { createHook: vi.fn(), FatalError: Error, getWorkflowMetadata: vi.fn() }
      if (id === 'workflow/api') return { start: vi.fn() }
      return new Proxy({}, { get: () => vi.fn() })
    },
    [Symbol.for('WORKFLOW_USE_STEP')]: (id: string) => (...args: unknown[]) => [id, ...args],
  })
  expect(compiledModule.exports).toHaveProperty('nativeHarnessWorkflow')
  expect(imports).not.toContain('server-only')
  expect(imports).not.toContain('@/server/bootstrap')
  expect(imports).not.toContain('@/server/database/lazy-convex')
  expect(imports).not.toContain('@/server/conversations/http')
  expect(imports.some(id => id.startsWith('@/server/agents/'))).toBe(false)
})

test.each([false, true])('compiled workflow can load and dispatch the credential-free model adapter (native: %s)', async native => {
  const path = fileURLToPath(new URL('./secure-model.ts', import.meta.url))
  const source = await readFile(path, 'utf8')
  const compiled = await applySwcTransform('src/server/harness/secure-model.ts', source, 'workflow', path)
  const { code } = await transform(compiled.code, { format: 'cjs', target: 'es2022' })
  const compiledModule = { exports: {} as { HarnessLanguageModel: typeof HarnessLanguageModel } }
  const dispatch = vi.fn()
  const steps = new Map<string, ReturnType<typeof vi.fn>>()
  runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id: string) => {
      if (id !== '@workflow/serde') throw new Error(`Unexpected workflow import: ${id}`)
      return { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE }
    },
    [Symbol.for('WORKFLOW_USE_STEP')]: (id: string) => {
      const step = vi.fn((...args: unknown[]) => dispatch(id, ...args))
      steps.set(id, step)
      return step
    },
  })
  const reference = { modelId: 'fixture/model', credentialOwnerId: 'fixture-user', ...(native ? { native: {
    access: { actorUserId: 'fixture-user', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
      principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
      agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
    receiptId: 'model:0', memoryEnabled: true, sharedRoom: false, requestFingerprint: 'request',
    inputTokenBudget: 1_000, maxOutputTokens: 100, contextWindow: 10_000,
  } } : {}) }
  const model = new compiledModule.exports.HarnessLanguageModel(reference)
  const options = { prompt: [] }
  await model.doStream(options)
  await model.doGenerate(options)
  expect(dispatch.mock.calls.map(([id]) => id)).toEqual([
    expect.stringContaining('//streamHarnessModel'),
    expect.stringContaining('//generateHarnessModel'),
  ])
  for (const [, step] of steps) expect(step).toHaveProperty('maxRetries', 0)
  for (const [, actualReference, actualOptions] of dispatch.mock.calls) {
    expect(actualReference).toBe(reference)
    expect(actualOptions).toBe(options)
  }
  expect(compiledModule.exports.HarnessLanguageModel[WORKFLOW_SERIALIZE](model)).toEqual(reference)
})
