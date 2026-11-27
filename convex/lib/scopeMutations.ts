import { v } from 'convex/values'
import { mutation, type MutationCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from './auth'
import {
  planArchive,
  planMove,
  planRestore,
  scopeContextLoader,
  type ScopedTable,
} from './resourceScope'
import type { ResourceKind, ScopedRow } from '../../src/shared/workspaces/resource-scope'

type ScopedDoc = ScopedRow & { workspaceId?: string }
type ScopeMutationArgs = { id: string; userId: string; workspaceId?: string; accessToken?: string; serverSecret?: string; actingAgentPrincipalId?: string; workspaceItemsOnly?: boolean }
type LooseDb = {
  get(id: unknown): Promise<ScopedDoc | null>
  patch(id: unknown, patch: Record<string, unknown>): Promise<void>
}

function rowScopeOf(row: ScopedDoc): 'personal' | 'workspace' {
  return row.scope ?? 'personal'
}

/** In a workspace context only Workspace items change; an archived item counts as the scope it was archived from. */
function outsideWorkspaceContext(args: { workspaceItemsOnly?: boolean }, row: ScopedDoc | null): boolean {
  if (args.workspaceItemsOnly !== true || !row) return false
  return (row.archivedAt !== undefined ? row.archivedFromScope ?? row.scope : row.scope) !== 'workspace'
}

/**
 * May an archive or restore of a folder carry this child with it? Only what the caller could archive or restore on its
 * own: a row they can edit and, in a workspace context, a Workspace row. A mixed tree (a teammate's Personal file in a
 * Workspace folder) keeps the rows the caller has no right to.
 */
function childPermission(ctx: unknown, args: { userId: string; workspaceItemsOnly?: boolean }) {
  const loader = scopeContextLoader(ctx as never, args.userId)
  return async (child: ScopedDoc): Promise<boolean> => !outsideWorkspaceContext(args, child) && await loader.canEdit(child as never)
}

const scopeValidator = v.union(v.literal('personal'), v.literal('workspace'))

async function authorize(params: { accessToken?: string; serverSecret?: string; userId: string }, requireServerAuthentication = false) {
  if (validateServerSecret(params.serverSecret)) return
  if (requireServerAuthentication) throw new Error('Unauthorized')
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

export type ScopeMutationResult = { ok: true } | { ok: false; reason: string }

/**
 * Checks a move to Workspace that the shared rules already allow, for what only this table knows (an automation's agent,
 * a server's credentials). It may refuse, or return extra fields to write with the move. It must not write before it
 * decides, since a refusal is returned, not thrown.
 */
export type BeforeMove = (
  ctx: MutationCtx,
  move: { id: string; row: ScopedDoc; userId: string; withAgent?: boolean; now: number },
) => Promise<{ ok: true; patch?: Record<string, unknown> } | { ok: false; reason: string }>

/**
 * `setScope`, `archive`, and `restore` for one scoped table. They return `{ ok: false, reason }` instead of throwing, so
 * the caller can answer with the right status. `onArchive` is extra fields written when archiving (an automation stops
 * running, for example).
 */
export function scopeMutations(
  table: ScopedTable,
  kind: ResourceKind,
  options?: {
    /** Keep resources whose policy lives in web routes behind the same server boundary. */
    requireServerAuthentication?: boolean
    onArchive?: Record<string, unknown>
    /** Table-specific checks and fields for a move to Workspace (see `BeforeMove`). */
    beforeMove?: BeforeMove
    /** Ids of the rows that belong under this one (a folder's contents), moved, archived, and restored with it. */
    descendants?: (db: unknown, id: string) => Promise<string[]>
    /** Runs after a move, archive, or restore was written (an activity log, for example). */
    afterApply?: (ctx: unknown, change: { action: 'scope' | 'archived' | 'restored'; id: string; row: ScopedDoc; userId: string; actingAgentPrincipalId?: string; to?: 'personal' | 'workspace'; affectedIds: string[] }) => Promise<void>
  },
) {
  const common = {
    id: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    actingAgentPrincipalId: v.optional(v.string()),
    /** Set for a workspace context (a room others can read, a workspace automation): only Workspace items may change. */
    workspaceItemsOnly: v.optional(v.boolean()),
  }

  /** The row, only if it exists, is in the workspace being asked about, and the caller can read it. */
  async function readableRow(ctx: { db: unknown }, args: { id: string; userId: string; workspaceId?: string }) {
    const db = ctx.db as unknown as LooseDb & { normalizeId(table: string, id: string): string | null }
    const id = db.normalizeId(table, args.id)
    const row = id ? await db.get(id) : null
    if (!row || (args.workspaceId !== undefined && row.workspaceId !== args.workspaceId)) return { db, id: null, row: null }
    const readable = await scopeContextLoader(ctx as never, args.userId).canRead(row)
    return { db, id, row: readable ? row : null }
  }

  async function applyScope(ctx: MutationCtx, args: ScopeMutationArgs & { to: 'personal' | 'workspace'; withAgent?: boolean }): Promise<ScopeMutationResult> {
    await authorize(args, options?.requireServerAuthentication)
    const { db, id, row } = await readableRow(ctx, args)
    // Moving shares a Personal item, which is its creator's call from their own place, not from a room or automation.
    if (args.workspaceItemsOnly === true && row) return { ok: false, reason: 'workspace_items_only' }
    const plan = await planMove(ctx, { kind, row, to: args.to, userId: args.userId })
    if (!plan.ok || !id || !row) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
    const extra = options?.beforeMove
      ? await options.beforeMove(ctx, { id, row, userId: args.userId, withAgent: args.withAgent, now: Date.now() })
      : { ok: true as const }
    if (!extra.ok) return { ok: false, reason: extra.reason }
    await db.patch(id, { ...plan.patch, ...(extra.patch ?? {}) })
    const moved = [id]
    // A folder's contents go with it: only the creator's own, not-archived rows.
    for (const childId of (await options?.descendants?.(db, id)) ?? []) {
      const child = await db.get(childId)
      if (child && !child.archivedAt && child.userId === row.userId) { await db.patch(childId, plan.patch); moved.push(childId) }
    }
    await options?.afterApply?.(ctx, { action: 'scope', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId, to: args.to, affectedIds: moved })
    return { ok: true }
  }
  const setScope = mutation({
    // `to: 'personal'` is accepted only to be refused with `one_way`. `withAgent` lets an automation take its agent along.
    args: { ...common, to: scopeValidator, withAgent: v.optional(v.boolean()) },
    handler: applyScope,
  })

  const archive = mutation({
    args: common,
    handler: async (ctx, args): Promise<ScopeMutationResult> => {
      await authorize(args, options?.requireServerAuthentication)
      const { db, id, row } = await readableRow(ctx, args)
      if (outsideWorkspaceContext(args, row)) return { ok: false, reason: 'workspace_items_only' }
      const plan = await planArchive(ctx, { row, userId: args.userId, now: Date.now() })
      if (!plan.ok || !id) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
      await db.patch(id, { ...plan.patch, ...(options?.onArchive ?? {}) })
      const affectedIds = [id]
      const mayChange = childPermission(ctx, args)
      for (const childId of (await options?.descendants?.(db, id)) ?? []) {
        const child = await db.get(childId)
        if (child && !child.archivedAt && child.userId === row?.userId && await mayChange(child)) {
          await db.patch(childId, { archivedAt: plan.patch.archivedAt, archivedBy: plan.patch.archivedBy, archivedFromScope: rowScopeOf(child), ...(options?.onArchive ?? {}) })
          affectedIds.push(childId)
        }
      }
      if (row) await options?.afterApply?.(ctx, { action: 'archived', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId, affectedIds })
      return { ok: true }
    },
  })

  const restore = mutation({
    args: common,
    handler: async (ctx, args): Promise<ScopeMutationResult> => {
      await authorize(args, options?.requireServerAuthentication)
      const { db, id, row } = await readableRow(ctx, args)
      if (outsideWorkspaceContext(args, row)) return { ok: false, reason: 'workspace_items_only' }
      const plan = await planRestore(ctx, { row, userId: args.userId })
      if (!plan.ok || !id) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
      const archivedAt = row?.archivedAt
      await db.patch(id, { scope: plan.scope, archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined })
      const affectedIds = [id]
      const mayChange = childPermission(ctx, args)
      // Only the contents that were archived together with it come back.
      for (const childId of (await options?.descendants?.(db, id)) ?? []) {
        const child = await db.get(childId)
        if (child && child.archivedAt !== undefined && child.archivedAt === archivedAt && await mayChange(child)) {
          await db.patch(childId, { scope: child.archivedFromScope ?? child.scope ?? 'personal', archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined })
          affectedIds.push(childId)
        }
      }
      if (row) await options?.afterApply?.(ctx, { action: 'restored', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId, affectedIds })
      return { ok: true }
    },
  })

  return { setScope, archive, restore, applyScope }
}
