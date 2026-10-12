import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Doc, Id } from '../_generated/dataModel'

const harnessValidator = v.union(v.literal('claude-code'), v.literal('codex'))
const statusValidator = v.union(
  v.literal('awaiting_upload'), v.literal('staged'), v.literal('active'), v.literal('superseded'), v.literal('discarded'),
)

/** Superseded versions kept per agent for rollback. */
const KEEP_SUPERSEDED = 9
const MAX_CHUNK_CHARS = 900_000

const profileValidator = v.object({
  id: v.string(),
  workspaceId: v.string(),
  agentId: v.string(),
  userId: v.string(),
  harness: harnessValidator,
  version: v.number(),
  status: statusValidator,
  codeExpiresAt: v.optional(v.number()),
  summary: v.optional(v.any()),
  meta: v.optional(v.any()),
  digest: v.optional(v.string()),
  chunkCount: v.optional(v.number()),
  hooksEnabled: v.boolean(),
  createdAt: v.number(),
  uploadedAt: v.optional(v.number()),
  appliedAt: v.optional(v.number()),
})

function toProfile(row: Doc<'agentProfiles'>) {
  return {
    id: row._id, workspaceId: row.workspaceId, agentId: row.agentId, userId: row.userId, harness: row.harness,
    version: row.version, status: row.status, codeExpiresAt: row.codeExpiresAt, summary: row.summary, meta: row.meta,
    digest: row.digest, chunkCount: row.chunkCount, hooksEnabled: row.hooksEnabled, createdAt: row.createdAt,
    uploadedAt: row.uploadedAt, appliedAt: row.appliedAt,
  }
}

async function forAgent(ctx: QueryCtx | MutationCtx, agentId: string) {
  return await ctx.db.query('agentProfiles').withIndex('by_agentId', (q) => q.eq('agentId', agentId)).take(200)
}

async function removeChunks(ctx: MutationCtx, profileId: Id<'agentProfiles'>) {
  const chunks = await ctx.db.query('agentProfileChunks').withIndex('by_profileId', (q) => q.eq('profileId', profileId)).take(100)
  for (const chunk of chunks) await ctx.db.delete(chunk._id)
}

/** Drops older staged or waiting imports for the agent: there is one pending import at a time. */
async function discardPending(ctx: MutationCtx, agentId: string) {
  for (const row of await forAgent(ctx, agentId)) {
    if (row.status === 'awaiting_upload' || row.status === 'staged') {
      await removeChunks(ctx, row._id)
      await ctx.db.patch(row._id, { status: 'discarded', codeHash: undefined })
    }
  }
}

async function pruneSuperseded(ctx: MutationCtx, agentId: string) {
  const old = (await forAgent(ctx, agentId)).filter((row) => row.status === 'superseded').sort((a, b) => b.version - a.version)
  for (const row of old.slice(KEEP_SUPERSEDED)) {
    await removeChunks(ctx, row._id)
    await ctx.db.delete(row._id)
  }
}

async function nextVersion(ctx: MutationCtx, agentId: string) {
  return (await forAgent(ctx, agentId)).reduce((max, row) => Math.max(max, row.version), 0) + 1
}

async function storeChunks(ctx: MutationCtx, profileId: Id<'agentProfiles'>, chunks: string[]) {
  for (const [index, data] of chunks.entries()) {
    if (data.length > MAX_CHUNK_CHARS) throw new Error('profile_chunk_too_large')
    await ctx.db.insert('agentProfileChunks', { profileId, index, data })
  }
}

/** A person asked to import from their computer: an upload slot a one-time code opens. */
export const createImportByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), userId: v.string(), harness: harnessValidator,
    codeHash: v.string(), codeExpiresAt: v.number(), now: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await discardPending(ctx, args.agentId)
    return await ctx.db.insert('agentProfiles', {
      workspaceId: args.workspaceId, agentId: args.agentId, userId: args.userId, harness: args.harness, version: 0,
      status: 'awaiting_upload', codeHash: args.codeHash, codeExpiresAt: args.codeExpiresAt, hooksEnabled: false, createdAt: args.now,
    })
  },
})

/** What an upload (by code, or straight from the signed-in page) becomes: a staged version waiting for review. */
const stagedFields = {
  summary: v.any(), meta: v.any(), digest: v.string(), chunks: v.array(v.string()), now: v.number(),
}

export const stageByCodeServer = mutation({
  args: { serverSecret: v.string(), codeHash: v.string(), harness: harnessValidator, ...stagedFields },
  returns: v.union(v.null(), v.object({ profileId: v.string(), agentId: v.string(), workspaceId: v.string() })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentProfiles').withIndex('by_codeHash', (q) => q.eq('codeHash', args.codeHash)).first()
    if (!row || row.status !== 'awaiting_upload' || (row.codeExpiresAt ?? 0) < args.now || row.harness !== args.harness) return null
    await storeChunks(ctx, row._id, args.chunks)
    await ctx.db.patch(row._id, {
      status: 'staged', codeHash: undefined, version: await nextVersion(ctx, row.agentId), summary: args.summary, meta: args.meta,
      digest: args.digest, chunkCount: args.chunks.length, uploadedAt: args.now,
    })
    return { profileId: row._id, agentId: row.agentId, workspaceId: row.workspaceId }
  },
})

export const stageDirectByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), userId: v.string(), harness: harnessValidator, ...stagedFields },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await discardPending(ctx, args.agentId)
    const id = await ctx.db.insert('agentProfiles', {
      workspaceId: args.workspaceId, agentId: args.agentId, userId: args.userId, harness: args.harness,
      version: await nextVersion(ctx, args.agentId), status: 'staged', summary: args.summary, meta: args.meta, digest: args.digest,
      chunkCount: args.chunks.length, hooksEnabled: false, createdAt: args.now, uploadedAt: args.now,
    })
    await storeChunks(ctx, id, args.chunks)
    return id
  },
})

export const getByServer = query({
  args: { serverSecret: v.string(), profileId: v.string() },
  returns: v.union(v.null(), profileValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('agentProfiles', args.profileId)
    const row = id ? await ctx.db.get(id) : null
    return row ? toProfile(row) : null
  },
})

export const listByAgentByServer = query({
  args: { serverSecret: v.string(), agentId: v.string() },
  returns: v.array(profileValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await forAgent(ctx, args.agentId))
      .filter((row) => row.status === 'staged' || row.status === 'active' || row.status === 'superseded'
        || (row.status === 'awaiting_upload' && (row.codeExpiresAt ?? 0) > Date.now()))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(toProfile)
  },
})

export const readChunksByServer = query({
  args: { serverSecret: v.string(), profileId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('agentProfiles', args.profileId)
    if (!id) return []
    const chunks = await ctx.db.query('agentProfileChunks').withIndex('by_profileId', (q) => q.eq('profileId', id)).take(100)
    return chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.data)
  },
})

/** This version becomes the active one; the one it replaces is kept for rollback. */
export const activateByServer = mutation({
  args: { serverSecret: v.string(), profileId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('agentProfiles', args.profileId)
    const row = id ? await ctx.db.get(id) : null
    if (!row || !['staged', 'superseded', 'active'].includes(row.status)) return false
    for (const other of await forAgent(ctx, row.agentId)) {
      if (other._id !== row._id && other.status === 'active') await ctx.db.patch(other._id, { status: 'superseded' })
    }
    await ctx.db.patch(row._id, { status: 'active', appliedAt: args.now })
    await pruneSuperseded(ctx, row.agentId)
    return true
  },
})

export const setHooksEnabledByServer = mutation({
  args: { serverSecret: v.string(), profileId: v.string(), enabled: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('agentProfiles', args.profileId)
    const row = id ? await ctx.db.get(id) : null
    if (!row) return false
    await ctx.db.patch(row._id, { hooksEnabled: args.enabled })
    return true
  },
})

export const discardByServer = mutation({
  args: { serverSecret: v.string(), profileId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('agentProfiles', args.profileId)
    const row = id ? await ctx.db.get(id) : null
    if (!row || (row.status !== 'staged' && row.status !== 'awaiting_upload')) return false
    await removeChunks(ctx, row._id)
    await ctx.db.patch(row._id, { status: 'discarded', codeHash: undefined })
    return true
  },
})

export const deleteAllForAgentByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string() },
  returns: v.object({ profiles: v.number(), secretRefs: v.array(v.string()) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await forAgent(ctx, args.agentId)
    for (const row of rows) { await removeChunks(ctx, row._id); await ctx.db.delete(row._id) }
    const secrets = await ctx.db.query('agentSecrets').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).take(200)
    for (const secret of secrets) await ctx.db.delete(secret._id)
    return { profiles: rows.length, secretRefs: secrets.map((secret) => secret.credentialRef) }
  },
})

/** Records where a secret's value is in the vault; returns the reference it replaced so the caller can delete that value. */
export const setSecretByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), userId: v.string(), name: v.string(), credentialRef: v.string(), now: v.number() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = (await ctx.db.query('agentSecrets').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).take(200))
      .find((row) => row.name === args.name)
    if (existing) {
      await ctx.db.patch(existing._id, { credentialRef: args.credentialRef, userId: args.userId, updatedAt: args.now })
      return existing.credentialRef
    }
    await ctx.db.insert('agentSecrets', {
      workspaceId: args.workspaceId, agentId: args.agentId, userId: args.userId, name: args.name, credentialRef: args.credentialRef, updatedAt: args.now,
    })
    return null
  },
})

/** Names only: for the agent page. */
export const listSecretNamesByServer = query({
  args: { serverSecret: v.string(), agentId: v.string() },
  returns: v.array(v.object({ name: v.string(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await ctx.db.query('agentSecrets').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).take(200))
      .map((row) => ({ name: row.name, updatedAt: row.updatedAt }))
  },
})

/** With vault references: server use only, to put values in a run's environment. */
export const listSecretRefsByServer = query({
  args: { serverSecret: v.string(), agentId: v.string() },
  returns: v.array(v.object({ name: v.string(), credentialRef: v.string() })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await ctx.db.query('agentSecrets').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).take(200))
      .map((row) => ({ name: row.name, credentialRef: row.credentialRef }))
  },
})

export const deleteSecretByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), name: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = (await ctx.db.query('agentSecrets').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).take(200))
      .find((candidate) => candidate.name === args.name)
    if (!row) return null
    await ctx.db.delete(row._id)
    return row.credentialRef
  },
})
