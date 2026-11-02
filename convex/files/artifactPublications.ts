import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { assertCanCreateInScope } from '../lib/resourceScope'
import { assertWorkspaceMembership } from '../lib/workspaceMembership'
import { requireHarnessPublicationAuthority } from '../harness/runs'
import type {
  ComputerArtifactInput,
  ComputerArtifactManifest,
  ComputerArtifactPrepare,
} from '../../src/shared/storage/file-publication'
import { keyForFile, assertOwnedFileR2Key } from '../../src/shared/storage/storage-keys'
import { assertParentAndProject, extensionOf } from './files'
import { assertMatchingFile, commitUploadedFile } from './lib/uploadPublication'
import { reserveUploadIntent } from './lib/uploadIntents'

type ArtifactReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

const referenceValidator = v.object({
  actorUserId: v.string(),
  runId: v.string(),
  workflowRunId: v.string(),
})

const inputValidator = v.object({
  artifactId: v.string(),
  sourcePath: v.string(),
  name: v.string(),
  mimeType: v.string(),
  parentId: v.optional(v.string()),
  scope: v.union(v.literal('personal'), v.literal('workspace')),
})

const snapshotValidator = v.object({
  sourceComputerId: v.string(),
  stagingPath: v.string(),
  checksumSha256: v.string(),
  sizeBytes: v.number(),
  mimeType: v.string(),
})

const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024
const MAX_NAME_LENGTH = 255
const MAX_PATH_LENGTH = 4096
// Upload authorization is request-scoped, even when the owning task has no deadline.
const ARTIFACT_UPLOAD_AUTHORIZATION_MS = 15 * 60 * 1_000

function assertArtifactInput(input: ComputerArtifactInput): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.artifactId)) {
    throw new Error('artifact_identity_invalid')
  }
  if (!input.sourcePath.startsWith('/') || input.sourcePath.length > MAX_PATH_LENGTH
    || /[\u0000-\u001f\u007f]/.test(input.sourcePath)
    || input.sourcePath.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('artifact_source_path_invalid')
  }
  if (!input.name || input.name.length > MAX_NAME_LENGTH || input.name === '.' || input.name === '..'
    || /[/\\\u0000-\u001f\u007f]/.test(input.name)) {
    throw new Error('artifact_name_invalid')
  }
  if (!input.mimeType || input.mimeType !== input.mimeType.trim().toLowerCase()
    || input.mimeType.length > 255 || /[\u0000-\u001f\u007f]/.test(input.mimeType)) {
    throw new Error('artifact_mime_invalid')
  }
}

function assertSnapshot(snapshot: ComputerArtifactPrepare['snapshot']): void {
  if (!snapshot.sourceComputerId || snapshot.sourceComputerId.length > 256
    || !snapshot.stagingPath.startsWith('/') || snapshot.stagingPath.length > MAX_PATH_LENGTH
    || /[\u0000-\u001f\u007f]/.test(snapshot.stagingPath)
    || snapshot.stagingPath.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('artifact_snapshot_invalid')
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.checksumSha256)
    || !Number.isSafeInteger(snapshot.sizeBytes) || snapshot.sizeBytes <= 0
    || snapshot.sizeBytes > MAX_ARTIFACT_BYTES
    || !snapshot.mimeType.trim() || snapshot.mimeType.length > 255
    || /[\u0000-\u001f\u007f]/.test(snapshot.mimeType)) {
    throw new Error('artifact_snapshot_invalid')
  }
}

async function authorizeDestination(
  ctx: Parameters<typeof assertCanCreateInScope>[0],
  input: ComputerArtifactInput,
  userId: string,
  workspaceId: string,
) {
  await assertWorkspaceMembership(ctx, { userId, workspaceId })
  const scope = await assertCanCreateInScope(ctx, {
    kind: 'content',
    scope: input.scope,
    workspaceId,
    userId,
  })
  if (scope !== input.scope) throw new Error('artifact_destination_mismatch')
  await assertParentAndProject(ctx, {
    parentId: input.parentId,
    userId,
    workspaceId,
    scope,
  })
  return scope
}

function toManifest(record: Doc<'harnessArtifacts'>): ComputerArtifactManifest {
  return {
    artifactId: record.artifactId,
    sourcePath: record.sourcePath,
    name: record.name,
    ...(record.parentId === undefined ? {} : { parentId: record.parentId }),
    scope: record.scope,
    sourceComputerId: record.sourceComputerId,
    stagingPath: record.stagingPath,
    checksumSha256: record.checksumSha256,
    sizeBytes: record.sizeBytes,
    mimeType: record.mimeType,
    userId: record.userId,
    workspaceId: record.workspaceId,
    rootRunId: record.rootRunId,
    r2Key: record.r2Key,
    uploadExpiresAt: record.uploadExpiresAt,
    ...(record.fileId === undefined ? {} : { fileId: record.fileId }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

async function getManifest(ctx: ArtifactReadCtx, rootRunId: string, artifactId: string) {
  return await ctx.db.query('harnessArtifacts')
    .withIndex('by_rootRunId_artifactId', q => q.eq('rootRunId', rootRunId).eq('artifactId', artifactId))
    .unique() as Doc<'harnessArtifacts'> | null
}

async function assertCommittedFile(ctx: ArtifactReadCtx, record: Doc<'harnessArtifacts'>) {
  if (!record.fileId) return
  assertMatchingFile(await ctx.db.get(record.fileId), {
    userId: record.userId,
    workspaceId: record.workspaceId,
    name: record.name,
    parentId: record.parentId,
    r2Key: record.r2Key,
    sizeBytes: record.sizeBytes,
    mimeType: record.mimeType,
    extension: extensionOf(record.name),
    scope: record.scope,
  })
}

export const get = query({
  args: {
    reference: referenceValidator,
    input: inputValidator,
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const authority = await requireHarnessPublicationAuthority(ctx, args.reference, args.serverSecret)
    assertArtifactInput(args.input)
    await authorizeDestination(ctx, args.input, args.reference.actorUserId, authority.workspaceId)
    const record = await getManifest(ctx, authority.rootRunId, args.input.artifactId)
    if (!record) return null
    if (record.userId !== args.reference.actorUserId || record.workspaceId !== authority.workspaceId
      || record.rootRunId !== authority.rootRunId || record.artifactId !== args.input.artifactId
      || record.sourcePath !== args.input.sourcePath || record.name !== args.input.name
      || record.parentId !== args.input.parentId || record.scope !== args.input.scope
      || record.mimeType !== args.input.mimeType) {
      throw new Error('artifact_identity_conflict')
    }
    await assertCommittedFile(ctx, record)
    if (record.uploadExpiresAt <= Date.now()) throw new Error('artifact_authority_expired')
    return toManifest(record)
  },
})

export const prepare = mutation({
  args: {
    reference: referenceValidator,
    input: inputValidator,
    snapshot: snapshotValidator,
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const authority = await requireHarnessPublicationAuthority(ctx, args.reference, args.serverSecret)
    assertArtifactInput(args.input)
    assertSnapshot(args.snapshot)
    if (args.input.mimeType !== args.snapshot.mimeType) {
      throw new Error('artifact_identity_conflict')
    }
    const scope = await authorizeDestination(ctx, args.input, args.reference.actorUserId, authority.workspaceId)
    const now = Date.now()
    if (authority.deadlineAt !== null && authority.deadlineAt <= now) throw new Error('artifact_authority_expired')
    const uploadExpiresAt = Math.min(now + ARTIFACT_UPLOAD_AUTHORIZATION_MS, authority.deadlineAt ?? Infinity)
    const existing = await getManifest(ctx, authority.rootRunId, args.input.artifactId)
    if (existing) {
      if (existing.userId !== args.reference.actorUserId || existing.workspaceId !== authority.workspaceId
        || existing.rootRunId !== authority.rootRunId || existing.artifactId !== args.input.artifactId
        || existing.sourcePath !== args.input.sourcePath || existing.name !== args.input.name
        || existing.parentId !== args.input.parentId || existing.scope !== scope
        || args.input.mimeType !== args.snapshot.mimeType
        || existing.checksumSha256 !== args.snapshot.checksumSha256
        || existing.sizeBytes !== args.snapshot.sizeBytes || existing.mimeType !== args.snapshot.mimeType) {
        throw new Error('artifact_identity_conflict')
      }
      if (existing.uploadExpiresAt <= now) throw new Error('artifact_authority_expired')
      await assertCommittedFile(ctx, existing)
      if (existing.fileId) return toManifest(existing)
      const updated = {
        ...existing,
        sourceComputerId: args.snapshot.sourceComputerId,
        stagingPath: args.snapshot.stagingPath,
        updatedAt: now,
      }
      await ctx.db.patch(existing._id, {
        sourceComputerId: updated.sourceComputerId,
        stagingPath: updated.stagingPath,
        updatedAt: now,
      })
      return toManifest(updated)
    }

    const identityKey = encodeURIComponent(JSON.stringify([authority.rootRunId, args.input.artifactId]))
    const r2Key = keyForFile(args.reference.actorUserId, identityKey, args.input.name)
    assertOwnedFileR2Key(args.reference.actorUserId, r2Key)
    await reserveUploadIntent(ctx, {
      userId: args.reference.actorUserId,
      r2Key,
      declaredSizeBytes: args.snapshot.sizeBytes,
      mimeType: args.snapshot.mimeType,
      expiresAt: uploadExpiresAt,
      now,
    })
    const record = {
      ...args.input,
      userId: args.reference.actorUserId,
      workspaceId: authority.workspaceId,
      rootRunId: authority.rootRunId,
      sourceComputerId: args.snapshot.sourceComputerId,
      stagingPath: args.snapshot.stagingPath,
      checksumSha256: args.snapshot.checksumSha256,
      sizeBytes: args.snapshot.sizeBytes,
      mimeType: args.snapshot.mimeType,
      r2Key,
      uploadExpiresAt,
      createdAt: now,
      updatedAt: now,
    }
    const id = await ctx.db.insert('harnessArtifacts', record)
    return toManifest({ ...record, _id: id, _creationTime: now } as Doc<'harnessArtifacts'>)
  },
})

export const commit = mutation({
  args: {
    reference: referenceValidator,
    input: inputValidator,
    r2Key: v.string(),
    checksumSha256: v.string(),
    sizeBytes: v.number(),
    serverSecret: v.string(),
  },
  returns: v.id('files'),
  handler: async (ctx, args) => {
    const authority = await requireHarnessPublicationAuthority(ctx, args.reference, args.serverSecret)
    assertArtifactInput(args.input)
    if (!/^[a-f0-9]{64}$/.test(args.checksumSha256)
      || !Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0 || args.sizeBytes > MAX_ARTIFACT_BYTES) {
      throw new Error('artifact_snapshot_invalid')
    }
    const scope = await authorizeDestination(ctx, args.input, args.reference.actorUserId, authority.workspaceId)
    const record = await getManifest(ctx, authority.rootRunId, args.input.artifactId)
    if (!record) throw new Error('artifact_manifest_not_found')
    if (record.userId !== args.reference.actorUserId || record.workspaceId !== authority.workspaceId
      || record.rootRunId !== authority.rootRunId || record.artifactId !== args.input.artifactId
      || record.sourcePath !== args.input.sourcePath || record.name !== args.input.name
      || record.parentId !== args.input.parentId || record.scope !== scope
      || record.mimeType !== args.input.mimeType
      || record.r2Key !== args.r2Key || record.checksumSha256 !== args.checksumSha256
      || record.sizeBytes !== args.sizeBytes) {
      throw new Error('artifact_identity_conflict')
    }
    await assertCommittedFile(ctx, record)
    if (record.fileId) return record.fileId
    const now = Date.now()
    if (record.uploadExpiresAt <= now) throw new Error('artifact_authority_expired')
    const intent = await ctx.db.query('r2UploadIntents')
      .withIndex('by_r2Key', q => q.eq('r2Key', record.r2Key))
      .unique()
    if (!intent || intent.userId !== record.userId || intent.status !== 'pending'
      || intent.declaredSizeBytes !== record.sizeBytes || intent.mimeType !== record.mimeType
      || intent.expiresAt !== record.uploadExpiresAt || intent.expiresAt <= now) {
      throw new Error('artifact_upload_intent_ineligible')
    }
    const fileId = await commitUploadedFile(ctx, {
      userId: record.userId,
      workspaceId: record.workspaceId,
      name: record.name,
      parentId: record.parentId,
      r2Key: record.r2Key,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      extension: extensionOf(record.name),
      scope: record.scope,
    }, now)
    await ctx.db.patch(record._id, { fileId, updatedAt: now })
    return fileId
  },
})
