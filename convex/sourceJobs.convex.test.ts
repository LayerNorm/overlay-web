import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { fileKeyPrefixForUser } from '../src/shared/storage/storage-keys'

const modules = import.meta.glob('./**/*.ts')
const secret = 'source-job-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const create = makeFunctionReference<'mutation'>('files/ingestion/jobs:createSourceJob')
const claim = makeFunctionReference<'mutation'>('files/ingestion/runner:markExtracting')
const fail = makeFunctionReference<'mutation'>('files/ingestion/runner:markFailed')
const store = makeFunctionReference<'mutation'>('files/files:storeExtractionByServer')
const update = makeFunctionReference<'mutation'>('files/files:update')
const remove = makeFunctionReference<'mutation'>('files/files:remove')
const updateJobStatus = makeFunctionReference<'mutation'>('files/ingestion/jobs:updateJobStatus')

async function fixture() {
  const convex = convexTest(schema, modules)
  const sourceChecksumSha256 = 'a'.repeat(64)
  const r2Key = `${fileKeyPrefixForUser('alice')}source/report.pdf`
  const { fileId, subscriptionId } = await convex.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'principal', workspaceId: 'workspace', type: 'human', userId: 'alice',
      displayName: 'Test', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'member', workspaceId: 'workspace', principalId: 'principal',
      role: 'member', status: 'active', joinedAt: 1, updatedAt: 1,
    })
    const fileId = await ctx.db.insert('files', {
      userId: 'alice', workspaceId: 'workspace', name: 'report.pdf', r2Key,
      sizeBytes: 12, mimeType: 'application/pdf', extension: 'pdf',
      type: 'file', kind: 'upload', sourceChecksumSha256, extractionStatus: 'pending',
      createdAt: 1, updatedAt: 1,
    })
    const subscriptionId = await ctx.db.insert('subscriptions', { userId: 'alice', overlayStorageBytesUsed: 12 })
    return { fileId, subscriptionId }
  })
  const args = {
    userId: 'alice', workspaceId: 'workspace', r2Key, fileName: 'report.pdf',
    mimeType: 'application/pdf', sizeBytes: 12, sourceFileId: fileId, sourceChecksumSha256, serverSecret: secret,
  }
  return { convex, fileId, subscriptionId, args }
}

test('source registration validates the immutable source and replays its stored job', async () => {
  const { convex, fileId, args } = await fixture()
  await expect(convex.mutation(create, { ...args, r2Key: `${fileKeyPrefixForUser('alice')}other.pdf` })).rejects.toThrow('source_file_conflict')
  await expect(convex.mutation(create, { ...args, sourceChecksumSha256: 'b'.repeat(64) })).rejects.toThrow('source_file_conflict')
  const folderId = await convex.run(ctx => ctx.db.insert('files', {
    userId: 'alice', workspaceId: 'workspace', name: 'folder.pdf', r2Key: args.r2Key,
    sizeBytes: 12, mimeType: 'application/pdf', type: 'folder', kind: 'folder',
    sourceChecksumSha256: args.sourceChecksumSha256, createdAt: 1, updatedAt: 1,
  }))
  await expect(convex.mutation(create, { ...args, sourceFileId: folderId })).rejects.toThrow('source_file_conflict')
  const id = await convex.mutation(create, args)
  expect(await convex.mutation(create, args)).toEqual(id)
  await convex.run(ctx => ctx.db.patch(id.jobId as never, { status: 'failed', attemptCount: 1 }))
  expect(await convex.mutation(create, args)).toEqual(id)
  await expect(convex.mutation(create, { ...args, fileName: 'other.pdf' })).rejects.toThrow('source_job_conflict')
  await convex.run(async ctx => {
    expect(await ctx.db.get(fileId)).toMatchObject({ r2Key: args.r2Key, sourceChecksumSha256: args.sourceChecksumSha256 })
    expect(await ctx.db.get(id.jobId as never)).toMatchObject({
      status: 'queued', r2Key: args.r2Key, sourceFileId: fileId, sourceChecksumSha256: args.sourceChecksumSha256,
      attemptCount: 1,
    })
  })
  await expect(convex.mutation(update, {
    fileId, userId: 'alice', serverSecret: secret, content: 'rewritten original',
  })).rejects.toThrow('Original source files are immutable')
  await expect(convex.mutation(update, {
    fileId, userId: 'alice', serverSecret: secret, r2Key: `${fileKeyPrefixForUser('alice')}rewritten.pdf`,
  })).rejects.toThrow('Original source files are immutable')
})

test('derived-byte replacements and removal apply exact storage quota deltas', async () => {
  const { convex, fileId, subscriptionId, args } = await fixture()
  const jobId = (await convex.mutation(create, args)).jobId
  const now = Date.now()
  await convex.mutation(claim, { jobId, attemptToken: 'quota-token', now, serverSecret: secret })
  const extractedTextKey = `${fileKeyPrefixForUser('alice')}derived/extracted.txt`
  const storeArgs = {
    serverSecret: secret, fileId, userId: 'alice', sourceChecksumSha256: args.sourceChecksumSha256,
    jobId, attemptToken: 'quota-token', extractionStatus: 'ready' as const,
    content: 'body', extractedTextKey,
  }
  await convex.mutation(store, { ...storeArgs, extractedTextBytes: 10 })
  await convex.mutation(store, { ...storeArgs, extractedTextKey: `${fileKeyPrefixForUser('alice')}derived/replacement.txt`, extractedTextBytes: 15 })
  expect(await convex.run(ctx => ctx.db.get(subscriptionId))).toMatchObject({ overlayStorageBytesUsed: 27 })
  await convex.mutation(remove, { fileId, userId: 'alice', serverSecret: secret, r2CleanupConfirmed: true })
  expect(await convex.run(ctx => ctx.db.get(subscriptionId))).toMatchObject({ overlayStorageBytesUsed: 0 })
})

test('a reclaimed lease fences stale extraction and failure writes', async () => {
  const { convex, fileId, args } = await fixture()
  const { jobId } = await convex.mutation(create, args)
  const now = Date.now()
  expect(await convex.mutation(claim, { jobId, attemptToken: 'old', now, serverSecret: secret })).toBe(true)
  await convex.run(ctx => ctx.db.patch(jobId as never, { leaseExpiresAt: now - 1 }))
  expect(await convex.mutation(claim, { jobId, attemptToken: 'new', now: now + 1, serverSecret: secret })).toBe(true)
  await expect(convex.mutation(store, {
    serverSecret: secret, fileId, userId: 'alice', sourceChecksumSha256: args.sourceChecksumSha256,
    jobId, attemptToken: 'old', extractionStatus: 'failed', extractionError: 'stale',
  })).rejects.toThrow('ingestion_lease_conflict')
  await expect(convex.mutation(updateJobStatus, {
    jobId, userId: 'alice', status: 'completed', attemptToken: 'old', serverSecret: secret,
  })).rejects.toThrow('stale_ingestion_worker')
  await convex.mutation(fail, { jobId, attemptToken: 'old', error: 'stale', serverSecret: secret })
  await convex.run(async ctx => {
    expect(await ctx.db.get(jobId as never)).toMatchObject({ status: 'extracting', leaseToken: 'new' })
    expect(await ctx.db.get(fileId)).toMatchObject({ extractionStatus: 'pending', r2Key: args.r2Key })
  })
})
