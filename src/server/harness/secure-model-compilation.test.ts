import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { applySwcTransform } from '@workflow/builders'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { transform } from 'esbuild'
import { expect, test, vi } from 'vitest'
import type { HarnessLanguageModel } from './secure-model'

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
