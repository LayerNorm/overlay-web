import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { claimWorkspaceHandle, getWorkspaceHandle, isWorkspaceHandleAvailable } from '../lib/workspaceHandles'
import {
  buildWorkspaceHandleCandidate,
  isReservedWorkspaceHandle,
  isWorkspaceHandleSyntaxValid,
  workspaceHandleBaseFromName,
} from '@/shared/workspaces/handle-policy'

const MIGRATION_KEY = 'workspace-handles-v1'
const MAX_BATCH_SIZE = 100

type PreviewRow = {
  workspaceId: string
  kind: 'personal' | 'organization'
  previousHandle?: string
  canonicalHandle: string
  changed: boolean
  conflict: boolean
  legacyPersonalAliasReserved: boolean
}

async function state(ctx: QueryCtx) {
  return await ctx.db.query('workspaceHandleMigrationState')
    .withIndex('by_key', (q) => q.eq('key', MIGRATION_KEY))
    .unique()
}

function stableSuffix(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

async function preferredHandle(
  ctx: Parameters<typeof isWorkspaceHandleAvailable>[0],
  workspace: Doc<'workspaces'>,
): Promise<string | null> {
  if (workspace.kind === 'organization'
    && isWorkspaceHandleSyntaxValid(workspace.slug)
    && !isReservedWorkspaceHandle(workspace.slug)
    && await isWorkspaceHandleAvailable(ctx, workspace.slug, workspace.workspaceId)) {
    return workspace.slug
  }
  const base = workspace.kind === 'personal'
    ? `personal-${stableSuffix(workspace.workspaceId)}`
    : workspaceHandleBaseFromName(workspace.name) ?? 'workspace'
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? stableSuffix(workspace.workspaceId) : `${stableSuffix(workspace.workspaceId)}${attempt.toString(36)}`
    const candidate = workspace.kind === 'personal'
      ? `personal-${suffix}`.slice(0, 63)
      : buildWorkspaceHandleCandidate(base, suffix)
    if (isWorkspaceHandleSyntaxValid(candidate)
      && await isWorkspaceHandleAvailable(ctx, candidate, workspace.workspaceId)) return candidate
  }
  return null
}

async function previewWorkspace(
  ctx: Parameters<typeof isWorkspaceHandleAvailable>[0],
  workspace: Doc<'workspaces'>,
): Promise<PreviewRow> {
  const registry = await getWorkspaceHandle(ctx, workspace.slug)
  const ready = registry?.workspaceId === workspace.workspaceId
    && registry.kind === 'canonical'
    && registry.visibility === 'public'
  const canonicalHandle = ready
    ? workspace.slug
    : await preferredHandle(ctx, workspace)
  return {
    workspaceId: workspace.workspaceId,
    kind: workspace.kind,
    ...(workspace.kind === 'organization' ? { previousHandle: workspace.slug } : {}),
    canonicalHandle: canonicalHandle ?? '',
    changed: canonicalHandle !== workspace.slug,
    conflict: canonicalHandle === null,
    legacyPersonalAliasReserved: workspace.kind === 'personal'
      && workspace.slug !== canonicalHandle
      && isWorkspaceHandleSyntaxValid(workspace.slug),
  }
}

export const previewWorkspaceHandlesBatchByServer = query({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('workspaces').paginate({
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, MAX_BATCH_SIZE),
    })
    const rows: PreviewRow[] = []
    for (const workspace of page.page) rows.push(await previewWorkspace(ctx, workspace))
    return {
      rows,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

export const migrateWorkspaceHandlesBatchByServer = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existingState = await state(ctx)
    if (!args.dryRun && existingState?.status === 'ready') {
      return { rows: 0, migrated: 0, conflicts: 0, continueCursor: '', isDone: true, ready: true }
    }
    const batchSize = Math.min(args.paginationOpts?.numItems ?? 50, MAX_BATCH_SIZE)
    const cursor = args.paginationOpts?.cursor ?? (args.dryRun ? null : existingState?.cursor ?? null)
    const page = await ctx.db.query('workspaces').paginate({ cursor, numItems: batchSize })
    let migrated = 0
    let conflicts = 0
    for (const workspace of page.page) {
      const plan = await previewWorkspace(ctx, workspace)
      if (plan.conflict) {
        conflicts++
        continue
      }
      if (args.dryRun || (!plan.changed && (await getWorkspaceHandle(ctx, plan.canonicalHandle))?.workspaceId === workspace.workspaceId)) {
        continue
      }
      try {
        if (workspace.kind === 'personal'
          && workspace.slug !== plan.canonicalHandle
          && isWorkspaceHandleSyntaxValid(workspace.slug)
          && await isWorkspaceHandleAvailable(ctx, workspace.slug, workspace.workspaceId)) {
          await claimWorkspaceHandle(ctx, {
            handle: workspace.slug,
            workspaceId: workspace.workspaceId,
            kind: 'alias',
            visibility: 'private',
            now: Date.now(),
            allowReserved: true,
          })
        } else if (
          workspace.kind === 'organization'
          && workspace.slug !== plan.canonicalHandle
          && isWorkspaceHandleSyntaxValid(workspace.slug)
          && isReservedWorkspaceHandle(workspace.slug)
          && await isWorkspaceHandleAvailable(ctx, workspace.slug, workspace.workspaceId)
        ) {
          await claimWorkspaceHandle(ctx, {
            handle: workspace.slug,
            workspaceId: workspace.workspaceId,
            kind: 'alias',
            visibility: 'private',
            now: Date.now(),
            allowReserved: true,
          })
        }
        await claimWorkspaceHandle(ctx, {
          handle: plan.canonicalHandle,
          workspaceId: workspace.workspaceId,
          kind: 'canonical',
          visibility: 'public',
          now: Date.now(),
          allowReserved: workspace.kind === 'personal',
        })
        await ctx.db.patch(workspace._id, {
          slug: plan.canonicalHandle,
          updatedAt: Date.now(),
        })
        migrated++
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('WORKSPACE_HANDLE_ALREADY_EXISTS')) throw error
        conflicts++
      }
    }
    if (args.dryRun) {
      return {
        rows: page.page.length,
        migrated,
        conflicts,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
        ready: false,
      }
    }
    const priorConflicts = existingState?.status === 'blocked' ? 0 : existingState?.conflictCount ?? 0
    const conflictCount = priorConflicts + conflicts
    const ready = page.isDone && conflictCount === 0
    const nextStatus = ready ? 'ready' : page.isDone ? 'blocked' : 'pending'
    if (existingState) {
      await ctx.db.patch(existingState._id, {
        status: nextStatus,
        cursor: page.isDone ? undefined : page.continueCursor,
        conflictCount,
        updatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('workspaceHandleMigrationState', {
        key: MIGRATION_KEY,
        status: nextStatus,
        cursor: page.isDone ? undefined : page.continueCursor,
        conflictCount,
        updatedAt: Date.now(),
      })
    }
    return {
      rows: page.page.length,
      migrated,
      conflicts,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      ready,
    }
  },
})
