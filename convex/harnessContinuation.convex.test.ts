import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'harness-continuation-test-secret'
const mutation = (name: string) => makeFunctionReference<'mutation'>(`harness/continuations:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`harness/continuations:${name}`)

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Harness continuation storage', () => {
  test('stores large V2 wait checkpoints outside Convex transactions and keeps pending launch retryable', async () => {
    const convex = convexTest(schema, modules)
    const generation = 7
    const runId = 'stored-continuation'
    const workflowRunId = 'workflow-current'
    const content = randomBytes(1_050_000).toString('base64')
    const checkpoint = {
      version: 1,
      messages: [{ role: 'assistant', content }],
      invocation: 14,
      modelCall: 22,
      stagnantSegments: 0,
      finalAnswerRequired: false,
      truncatedResponse: false,
      segmentStartedAt: Date.now(),
    }
    const launchInput = {
      access: {
        actorUserId: 'alice',
        workspaceId: 'workspace',
        runId,
        executionGeneration: generation + 1,
      },
    }
    const compressed = gzipSync(Buffer.from(JSON.stringify({ checkpoint, launchInput }), 'utf8'))
    expect(compressed.byteLength).toBeGreaterThan(1_000_000)

    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId,
        actorUserId: 'alice',
        rootRunId: runId,
        activeDescendantCount: 0,
        sourceJson: '{}',
        admissionJson: '{}',
        metadataJson: JSON.stringify({
          runId,
          rootRunId: runId,
          actorUserId: 'alice',
          status: 'waiting_for_input',
          workflowRunId,
          executionGeneration: generation,
          revision: 12,
          planRevision: 1,
          policy: { actorUserId: 'alice', workspaceId: 'workspace', executionPolicyVersion: 2 },
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const upload = await convex.mutation(mutation('generateUploadUrl'), {
      actorUserId: 'alice', serverSecret: secret, runId, workflowRunId, executionGeneration: generation,
    }) as { uploadUrl: string }
    expect(upload.uploadUrl).toMatch(/^https?:\/\//)
    await expect(convex.mutation(mutation('generateUploadUrl'), {
      actorUserId: 'mallory', serverSecret: secret, runId, workflowRunId, executionGeneration: generation,
    })).rejects.toThrow('HARNESS_RUN_NOT_FOUND')

    const checkpointStorageId = await convex.run(ctx => ctx.storage.store(new Blob([
      new Uint8Array(compressed),
    ], { type: 'application/gzip' })))
    const handoff = await convex.mutation(mutation('handoff'), {
      actorUserId: 'alice',
      serverSecret: secret,
      runId,
      workflowRunId,
      executionGeneration: generation,
      expectedRevision: 12,
      workflowKind: 'personal',
      checkpointStorageId,
    }) as { revision: number; executionGeneration: number; status: string }

    expect(handoff).toMatchObject({
      revision: 13,
      executionGeneration: generation + 1,
      status: 'waiting_for_input',
    })
    const checkpointRow = await convex.run(ctx => ctx.db.query('harnessCheckpoints')
      .withIndex('by_checkpointToken', q => q.eq('checkpointToken', `${runId}:${generation + 1}`)).unique())
    const storageMetadata = await convex.run(ctx => ctx.db.system.get(checkpointStorageId))
    expect(checkpointRow?.checkpointStorageId).toBe(checkpointStorageId)
    expect(checkpointRow?.checkpointJson).toBeUndefined()
    expect(checkpointRow?.launchInputJson).toBeUndefined()
    expect(storageMetadata?.size).toBeGreaterThan(1_000_000)

    const launchArgs = {
      serverSecret: secret,
      runId,
      generation: generation + 1,
      checkpointToken: `${runId}:${generation + 1}`,
    }
    const launch = await convex.query(query('getLaunch'), launchArgs) as {
      checkpointStorageUrl?: string
      checkpointJson?: string
      launchInputJson?: string
      executionGeneration: number
    } | null
    expect(launch?.checkpointStorageUrl).toMatch(/^https?:\/\//)
    expect(launch?.checkpointJson).toBeUndefined()
    expect(launch?.launchInputJson).toBeUndefined()
    expect(launch?.executionGeneration).toBe(generation + 1)

    await expect(convex.mutation(mutation('noteAttempt'), {
      runId,
      generation: generation + 1,
      checkpointToken: `${runId}:${generation + 1}`,
    } as never)).rejects.toThrow()
    await convex.mutation(mutation('noteAttempt'), { runId, generation: generation + 1 })
    const pendingLaunch = await convex.query(query('getLaunch'), launchArgs)
    expect(pendingLaunch).not.toBeNull()
    const outbox = await convex.run(ctx => ctx.db.query('harnessContinuationOutbox')
      .withIndex('by_runId_generation', q => q.eq('runId', runId).eq('generation', generation + 1)).unique())
    expect(outbox).toMatchObject({ state: 'pending', attempts: 1 })
  })

  test('rejects stale owners and expired explicit deadlines before upload', async () => {
    const convex = convexTest(schema, modules)
    const runId = 'stale-continuation'
    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId,
        actorUserId: 'alice',
        rootRunId: runId,
        activeDescendantCount: 0,
        sourceJson: '{}',
        admissionJson: '{}',
        metadataJson: JSON.stringify({
          runId,
          rootRunId: runId,
          actorUserId: 'alice',
          status: 'running',
          workflowRunId: 'current',
          executionGeneration: 2,
          revision: 5,
          planRevision: 1,
          policy: {
            actorUserId: 'alice',
            executionPolicyVersion: 2,
            taskDeadlineAt: Date.now() - 1,
          },
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    await expect(convex.mutation(mutation('generateUploadUrl'), {
      actorUserId: 'alice', serverSecret: secret, runId, workflowRunId: 'stale', executionGeneration: 2,
    })).rejects.toThrow('HARNESS_EXECUTION_NOT_OWNED')
    await expect(convex.mutation(mutation('generateUploadUrl'), {
      actorUserId: 'alice', serverSecret: secret, runId, workflowRunId: 'current', executionGeneration: 2,
    })).rejects.toThrow('HARNESS_CONTINUATION_BOUNDARY_UNSAFE')

    const storageId = await convex.run(ctx => ctx.storage.store(new Blob(['checkpoint'])))
    await expect(convex.mutation(mutation('handoff'), {
      actorUserId: 'alice', serverSecret: secret, runId, workflowRunId: 'current',
      executionGeneration: 2, expectedRevision: 5, workflowKind: 'native', checkpointStorageId: storageId,
    })).rejects.toThrow('HARNESS_CONTINUATION_BOUNDARY_UNSAFE')
  })

  test('rejects handoffs whose storage metadata disappeared before the transaction', async () => {
    const convex = convexTest(schema, modules)
    const runId = 'missing-continuation-storage'
    await convex.run(async ctx => {
      await ctx.db.insert('harnessRuns', {
        runId,
        actorUserId: 'alice',
        rootRunId: runId,
        activeDescendantCount: 0,
        sourceJson: '{}',
        admissionJson: '{}',
        metadataJson: JSON.stringify({
          runId,
          rootRunId: runId,
          actorUserId: 'alice',
          status: 'waiting_for_approval',
          workflowRunId: 'current',
          executionGeneration: 3,
          revision: 8,
          planRevision: 1,
          policy: { actorUserId: 'alice', executionPolicyVersion: 2 },
        }),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })
    const storageId = await convex.run(async ctx => {
      const id = await ctx.storage.store(new Blob(['checkpoint']))
      await ctx.storage.delete(id)
      return id
    })
    await expect(convex.mutation(mutation('handoff'), {
      actorUserId: 'alice', serverSecret: secret, runId, workflowRunId: 'current',
      executionGeneration: 3, expectedRevision: 8, workflowKind: 'native', checkpointStorageId: storageId,
    })).rejects.toThrow('HARNESS_CONTINUATION_STORAGE_NOT_FOUND')
  })
})
