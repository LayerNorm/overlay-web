import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { FREE_PLAN_STORAGE_BYTES } from '../src/shared/billing/billing-pricing'
import type { HarnessAdmission, HarnessOperation } from '../packages/overlay-agent-runtime/src/harness-store'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'computer-publication-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const harnessMutation = (name: string) => makeFunctionReference<'mutation'>(`harness/runs:${name}`)
const publicationQuery = makeFunctionReference<'query'>('files/artifactPublications:get')
const publicationMutation = (name: string) => makeFunctionReference<'mutation'>(`files/artifactPublications:${name}`)
const userId = 'alice'
const workspaceId = 'workspace'
const input = {
  artifactId: 'film-final',
  sourcePath: '/tmp/final.mp4',
  name: 'film.mp4',
  mimeType: 'video/mp4',
  scope: 'personal' as const,
}
const snapshot = {
  sourceComputerId: 'computer-1',
  stagingPath: '/tmp/overlay-artifact-final.mp4',
  checksumSha256: 'a'.repeat(64),
  sizeBytes: 5,
  mimeType: 'video/mp4',
}

async function fixture(deadlineAt = Date.now() + 60_000) {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'principal-alice', workspaceId, type: 'human', userId,
      displayName: 'Alice', createdAt: 1, updatedAt: 1,
    })
    const membership = await ctx.db.insert('workspaceMemberships', {
      membershipId: 'membership-alice', workspaceId, principalId: 'principal-alice',
      role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1,
    })
    const conversationId = await ctx.db.insert('conversations', {
      userId, workspaceId, conversationType: 'personal', title: 'Harness publication',
      lastModified: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
      lastMode: 'act', askModelIds: ['fixture/model'], actModelId: 'fixture/model',
    })
    const folder = await ctx.db.insert('files', {
      userId, workspaceId, scope: 'personal', name: 'Films',
      type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1,
    })
    const otherFolder = await ctx.db.insert('files', {
      userId: 'other', workspaceId: 'other-workspace', scope: 'workspace',
      name: 'Private', type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1,
    })
    return { membership, conversationId, folder, otherFolder }
  })
  const admission: HarnessAdmission = {
    runId: 'publication-run',
    goal: 'Publish the requested binary artifact.',
    constraints: [],
    policy: {
      actorUserId: userId,
      workspaceId,
      allowedToolIds: ['computer_publish_file', 'write_file'],
      requiresPlan: true,
      deadlineAt,
      maxCostMicros: 100,
      maxParallelChildren: 1,
      maxDepth: 1,
    },
    source: { conversationId: ids.conversationId },
  }
  await convex.mutation(harnessMutation('admit'), { ...admission, serverSecret: secret })
  const claim: HarnessOperation = { type: 'claim_execution', workflowRunId: 'workflow-publication' }
  await convex.mutation(harnessMutation('apply'), {
    actorUserId: userId,
    runId: admission.runId,
    operationId: 'claim-publication',
    expectedRevision: 0,
    operation: claim,
    serverSecret: secret,
  })
  const reference = { actorUserId: userId, runId: admission.runId, workflowRunId: 'workflow-publication' }
  return { convex, admission, reference, ...ids }
}

function publicationArgs(reference: { actorUserId: string; runId: string; workflowRunId: string },
  artifactInput = input, artifactSnapshot = snapshot) {
  return { reference, input: artifactInput, snapshot: artifactSnapshot, serverSecret: secret }
}

test('admitted and claimed run prepares concurrently once, then commits and replays one file and one charge', async () => {
  const { convex, reference } = await fixture()
  const args = publicationArgs(reference)
  const [first, replay] = await Promise.all([
    convex.mutation(publicationMutation('prepare'), args),
    convex.mutation(publicationMutation('prepare'), args),
  ])
  expect(first).toMatchObject({ artifactId: input.artifactId, checksumSha256: snapshot.checksumSha256 })
  expect(replay.r2Key).toBe(first.r2Key)
  const committedId = await convex.mutation(publicationMutation('commit'), {
    reference, input, r2Key: first.r2Key, checksumSha256: snapshot.checksumSha256,
    sizeBytes: snapshot.sizeBytes, serverSecret: secret,
  })
  expect(await convex.mutation(publicationMutation('commit'), {
    reference, input, r2Key: first.r2Key, checksumSha256: snapshot.checksumSha256,
    sizeBytes: snapshot.sizeBytes, serverSecret: secret,
  })).toBe(committedId)
  expect(await convex.query(publicationQuery, { reference, input, serverSecret: secret })).toMatchObject({
    artifactId: input.artifactId, fileId: committedId, r2Key: first.r2Key,
  })
  await convex.run(async ctx => {
    const files = (await ctx.db.query('files').collect()).filter(file => file.type === 'file')
    expect(files).toHaveLength(1)
    expect(files[0]?.createdByAgent).toBe(true)
    expect(await ctx.db.query('r2UploadIntents').collect()).toHaveLength(1)
    expect(await ctx.db.query('subscriptions').collect()).toContainEqual(expect.objectContaining({
      userId, overlayStorageBytesUsed: snapshot.sizeBytes,
    }))
  })
})

test('manifest identity and frozen content metadata cannot be changed on replay', async () => {
  const { convex, reference } = await fixture()
  await convex.mutation(publicationMutation('prepare'), publicationArgs(reference))
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference, {
    ...input, name: 'changed.mp4',
  }))).rejects.toThrow('artifact_identity_conflict')
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference, {
    ...input, mimeType: 'video/webm',
  }))).rejects.toThrow('artifact_identity_conflict')
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference, input, {
    ...snapshot, checksumSha256: 'b'.repeat(64),
  }))).rejects.toThrow('artifact_identity_conflict')
})

test('prepare rejects mismatched MIME and authorization rejects dangling folder ancestry', async () => {
  const { convex, reference } = await fixture()
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference, input, {
    ...snapshot,
    mimeType: 'video/webm',
  }))).rejects.toThrow('artifact_identity_conflict')

  const childFolder = await convex.run(async ctx => {
    const ancestor = await ctx.db.insert('files', {
      userId,
      workspaceId,
      scope: 'personal',
      name: 'removed ancestor',
      type: 'folder',
      kind: 'folder',
      createdAt: 1,
      updatedAt: 1,
    })
    const child = await ctx.db.insert('files', {
      userId,
      workspaceId,
      scope: 'personal',
      name: 'dangling child',
      type: 'folder',
      kind: 'folder',
      parentId: ancestor,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.delete(ancestor)
    return child
  })
  await expect(convex.query(publicationQuery, {
    reference,
    input: { ...input, parentId: childFolder },
    serverSecret: secret,
  })).rejects.toThrow('Unauthorized')
})

test('rejects wrong actors, revoked workspace membership, archived destinations, and expired authority', async () => {
  const { convex, reference, membership, folder, otherFolder } = await fixture()
  const args = publicationArgs(reference)
  await expect(convex.query(publicationQuery, {
    reference: { ...reference, actorUserId: 'other' }, input, serverSecret: secret,
  })).rejects.toThrow('HARNESS_ACCESS_DENIED')
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference, {
    ...input, parentId: otherFolder,
  }))).rejects.toThrow('Unauthorized')
  const folderInput = { ...input, artifactId: 'film-folder', parentId: folder }
  const folderManifest = await convex.mutation(publicationMutation('prepare'), publicationArgs(reference, folderInput))
  await convex.run(ctx => ctx.db.patch(folder, { archivedAt: Date.now() }))
  await expect(convex.mutation(publicationMutation('commit'), {
    reference, input: folderInput, r2Key: folderManifest.r2Key, checksumSha256: snapshot.checksumSha256,
    sizeBytes: snapshot.sizeBytes, serverSecret: secret,
  })).rejects.toThrow('Unauthorized')
  const prepared = await convex.mutation(publicationMutation('prepare'), args)
  await convex.run(ctx => ctx.db.patch(membership, { status: 'suspended' }))
  await expect(convex.mutation(publicationMutation('commit'), {
    reference, input, r2Key: prepared.r2Key, checksumSha256: snapshot.checksumSha256,
    sizeBytes: snapshot.sizeBytes, serverSecret: secret,
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')

  const expired = await fixture()
  await expired.convex.run(async ctx => {
    const run = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', query => query.eq('runId', expired.admission.runId))
      .unique()
    if (!run) throw new Error('Harness fixture run is missing')
    const metadata = JSON.parse(run.metadataJson) as { policy: { deadlineAt: number } }
    metadata.policy.deadlineAt = Date.now() - 1
    await ctx.db.patch(run._id, { metadataJson: JSON.stringify(metadata) })
  })
  await expect(expired.convex.query(publicationQuery, {
    reference: expired.reference, input, serverSecret: secret,
  })).rejects.toThrow('HARNESS_PUBLICATION_NOT_AUTHORIZED')
  const terminal = await fixture()
  await terminal.convex.run(async ctx => {
    const run = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', query => query.eq('runId', terminal.admission.runId))
      .unique()
    if (!run) throw new Error('Harness fixture run is missing')
    await ctx.db.patch(run._id, {
      metadataJson: JSON.stringify({ ...JSON.parse(run.metadataJson), status: 'failed' }),
    })
  })
  await expect(terminal.convex.query(publicationQuery, {
    reference: terminal.reference, input, serverSecret: secret,
  })).rejects.toThrow('terminal')
})

test('refuses quota exhaustion and does not allocate a manifest or upload intent', async () => {
  const { convex, reference } = await fixture()
  await convex.run(async ctx => {
    const subscriptionId = await ctx.db.insert('subscriptions', { userId, overlayStorageBytesUsed: FREE_PLAN_STORAGE_BYTES })
    expect(subscriptionId).toBeTruthy()
  })
  await expect(convex.mutation(publicationMutation('prepare'), publicationArgs(reference)))
    .rejects.toThrow(/storage_limit_exceeded/)
  await convex.run(async ctx => {
    expect(await ctx.db.query('harnessArtifacts').collect()).toHaveLength(0)
    expect(await ctx.db.query('r2UploadIntents').collect()).toHaveLength(0)
  })
})
