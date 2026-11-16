import { ConvexError, v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireServerSecret } from '../lib/auth'
import { getReadableRow } from '../lib/resourceScope'
import { threadWorkValidator } from '../lib/threadWork'
import { visibleRow } from './directory'
import { agentToolCapabilities, normalizeAgentToolGrant } from '../../src/shared/agents/tool-groups'
import { THREAD_WORK_LOCKED, sameThreadWork, threadWorkProblem, type ThreadFolder, type ThreadWork } from '../../src/shared/agents/thread-work'

/**
 * Where an agent thread works: its computer and chosen folders (internal/develop/thread-folders.md).
 * Any active member of the thread can read it and choose it before the thread's first message; after that it is
 * fixed. A person's own computer can only be chosen by the person who connected it, and a run uses that computer
 * only when its owner started the run.
 */

const threadArgs = { workspaceId: v.string(), agentId: v.string(), conversationId: v.id('conversations') }

async function requireThread(ctx: QueryCtx, args: { workspaceId: string; agentId: string; conversationId: Doc<'conversations'>['_id'] }) {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  const agentRow = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique()
  if (!await visibleRow(ctx, agentRow, viewer)) throw new ConvexError('AGENT_NOT_FOUND')
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== args.workspaceId
    || conversation.agentId !== args.agentId) throw new ConvexError('THREAD_NOT_FOUND')
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversation._id)
      .eq('principalId', viewer.principal.principalId)).unique()
  if (!participant || participant.principalType !== 'human' || participant.status !== 'active'
    || participant.removedAt !== undefined) throw new ConvexError('THREAD_NOT_FOUND')
  return { viewer, conversation }
}

function storedWork(conversation: Doc<'conversations'>): ThreadWork {
  return (conversation.work as ThreadWork | undefined) ?? { folders: [] }
}

async function assertOwnMac(ctx: QueryCtx, workspaceId: string, userId: string, environmentId: string) {
  const environment = await ctx.db.query('agentEnvironments')
    .withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
  if (!environment || environment.workspaceId !== workspaceId || environment.kind !== 'local'
    || environment.approvedByUserId !== userId || environment.revokedAt !== undefined
    || environment.status === 'revoked' || environment.status === 'pending') {
    throw new ConvexError('THREAD_WORK_MAC_UNAVAILABLE')
  }
}

async function assertFolderUsable(ctx: QueryCtx, workspaceId: string, userId: string, folder: ThreadFolder) {
  if (folder.source === 'overlay') {
    const id = ctx.db.normalizeId('files', folder.fileId)
    const row = id ? await getReadableRow(ctx, { row: await ctx.db.get(id), userId, workspaceId }) : null
    if (!row || row.type !== 'folder' || row.deletedAt !== undefined || row.archivedAt !== undefined) {
      throw new ConvexError('THREAD_WORK_FOLDER_UNAVAILABLE')
    }
    return
  }
  if (folder.source === 'github') {
    const installation = await ctx.db.query('githubInstallations')
      .withIndex('by_workspaceId_installationId', q => q.eq('workspaceId', workspaceId).eq('installationId', folder.installationId))
      .unique()
    if (!installation || installation.removedAt !== undefined) throw new ConvexError('THREAD_WORK_REPOSITORY_UNAVAILABLE')
    return
  }
  await assertOwnMac(ctx, workspaceId, userId, folder.environmentId)
}

/** The thread's computer and folders, for the composer pickers. */
export const get = query({
  args: threadArgs,
  handler: async (ctx, args) => {
    try {
      const { conversation } = await requireThread(ctx, args)
      return storedWork(conversation)
    } catch (error) {
      if (error instanceof ConvexError || (error instanceof Error && ['UNAUTHENTICATED', 'WORKSPACE_ACCESS_DENIED'].includes(error.message))) return null
      throw error
    }
  },
})

export const set = mutation({
  args: { ...threadArgs, work: threadWorkValidator },
  handler: async (ctx, args) => {
    const { viewer, conversation } = await requireThread(ctx, args)
    const work = args.work as ThreadWork
    const problem = threadWorkProblem(work)
    if (problem) throw new ConvexError(problem)
    const current = storedWork(conversation)
    if (sameThreadWork(current, work)) return current
    // Where a thread runs and its folder are part of how it started: a run already copied or used them.
    const started = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId', q => q.eq('conversationId', conversation._id)).first()
    if (started) throw new ConvexError(THREAD_WORK_LOCKED)
    // A Mac already chosen by its owner stays usable by the thread; a newly chosen Mac must be the viewer's own.
    if (work.computer?.kind === 'mac') {
      const unchanged = current.computer?.kind === 'mac' && current.computer.environmentId === work.computer.environmentId
      if (!unchanged) await assertOwnMac(ctx, args.workspaceId, viewer.userId, work.computer.environmentId)
    }
    const known = new Set(current.folders.map(folder => JSON.stringify(folder)))
    for (const folder of work.folders) {
      if (!known.has(JSON.stringify(folder))) await assertFolderUsable(ctx, args.workspaceId, viewer.userId, folder)
    }
    await ctx.db.patch(conversation._id, { work })
    return work
  },
})

function grantRoots(grant: unknown): string[] {
  const value = grant as { mode?: string; roots?: unknown } | undefined
  return value?.mode === 'selected_roots' && Array.isArray(value.roots) ? value.roots.filter((root): root is string => typeof root === 'string') : []
}

type FolderOption = { fileId: string; name: string; path: string; scope: 'personal' | 'workspace' }

/** Readable folders at the top of Files and one level down, for the folder picker. */
async function folderOptions(ctx: QueryCtx, workspaceId: string, userId: string): Promise<FolderOption[]> {
  const usable = (row: Doc<'files'>) => row.type === 'folder' && row.deletedAt === undefined && row.archivedAt === undefined
  const shared = await ctx.db.query('files').withIndex('by_workspaceId_scope_parentId', q => q.eq('workspaceId', workspaceId).eq('scope', 'workspace').eq('parentId', undefined)).take(200)
  const own = await ctx.db.query('files').withIndex('by_workspaceId_userId_parentId_updatedAt', q => q.eq('workspaceId', workspaceId).eq('userId', userId).eq('parentId', undefined)).take(300)
  const top = [...shared, ...own.filter(row => (row.scope ?? 'personal') === 'personal')].filter(usable)
  const options: FolderOption[] = []
  for (const row of top) {
    if (!await getReadableRow(ctx, { row, userId, workspaceId })) continue
    const scope = row.scope === 'workspace' ? 'workspace' : 'personal'
    options.push({ fileId: row._id, name: row.name, path: row.name, scope })
    const children = await ctx.db.query('files').withIndex('by_parentId', q => q.eq('parentId', row._id)).take(100)
    for (const child of children) {
      if (!usable(child) || child.workspaceId !== workspaceId || !await getReadableRow(ctx, { row: child, userId, workspaceId })) continue
      options.push({ fileId: child._id, name: child.name, path: `${row.name}/${child.name}`, scope })
    }
    if (options.length >= 300) break
  }
  return options.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * What a thread can pick: the agent's cloud Computer, the viewer's own computers (never a teammate's) with their
 * approved folders when the agent has the Local computer tool group, Overlay folders, and whether GitHub is connected.
 */
export const options = query({
  args: { workspaceId: v.string(), agentId: v.string() },
  handler: async (ctx, args) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return null
    }
    const agentRow = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique()
    if (!await visibleRow(ctx, agentRow, viewer)) return null
    const computer = await ctx.db.query('computers')
      .withIndex('by_workspaceId_owner', q => q.eq('workspaceId', args.workspaceId).eq('ownerType', 'agent').eq('ownerId', args.agentId)).first()
    const environments = await ctx.db.query('agentEnvironments').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).take(200)
    const macs = environments
      .filter(row => row.kind === 'local' && row.approvedByUserId === viewer.userId && row.revokedAt === undefined
        && row.status !== 'revoked' && row.status !== 'pending')
      .map(row => ({
        environmentId: row.environmentId, name: row.name, status: row.status, lastSeenAt: row.lastSeenAt ?? null,
        roots: grantRoots(row.filesystemGrant),
        allFiles: (row.filesystemGrant as { mode?: string } | undefined)?.mode === 'all_user_files',
      }))
    const github = await ctx.db.query('githubInstallations').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    // The default agent holds every tool group without listing them; other agents list theirs.
    const grant = agentRow?.allowedToolIds ?? []
    const localComputer = (agentRow?.isDefault === true && grant.length === 0)
      || agentToolCapabilities(normalizeAgentToolGrant(grant)).has('local_computer')
    return {
      cloud: computer ? { status: computer.status, name: computer.name ?? null } : null,
      /** Whether the agent has the Local computer tool group, so a thread can run on the viewer's own computer. */
      localComputer,
      macs,
      folders: await folderOptions(ctx, args.workspaceId, viewer.userId),
      githubConnected: github.some(row => row.removedAt === undefined),
    }
  },
})

/** The work settings the server reads when it starts a run. */
export const getByServer = query({
  args: { serverSecret: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('conversations', args.conversationId)
    const conversation = id ? await ctx.db.get(id) : null
    return conversation ? storedWork(conversation) : null
  },
})
