import { v } from 'convex/values'
import { mutation } from '../_generated/server'
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
type LooseDb = {
  get(id: unknown): Promise<ScopedDoc | null>
  patch(id: unknown, patch: Record<string, unknown>): Promise<void>
}

function rowScopeOf(row: ScopedDoc): 'personal' | 'workspace' {
  return row.scope ?? 'personal'
}

const scopeValidator = v.union(v.literal('personal'), v.literal('workspace'))

async function authorize(params: { accessToken?: string; serverSecret?: string; userId: string }) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

export type ScopeMutationResult = { ok: true } | { ok: false; reason: string }

/**
 * `setScope`, `archive`, and `restore` for one scoped table. They return `{ ok: false, reason }` instead of throwing, so
 * the caller can answer with the right status. `onArchive` is extra fields written when archiving (an automation stops
 * running, for example).
 */
export function scopeMutations(
  table: ScopedTable,
  kind: ResourceKind,
  options?: {
    onArchive?: Record<string, unknown>
    /** Ids of the rows that belong under this one (a folder's contents), moved, archived, and restored with it. */
    descendants?: (db: unknown, id: string) => Promise<string[]>
    /** Runs after a move, archive, or restore was written (an activity log, for example). */
    afterApply?: (ctx: unknown, change: { action: 'scope' | 'archived' | 'restored'; id: string; row: ScopedDoc; userId: string; actingAgentPrincipalId?: string; to?: 'personal' | 'workspace'; moved?: string[] }) => Promise<void>
  },
) {
  const common = {
    id: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    actingAgentPrincipalId: v.optional(v.string()),
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

  const setScope = mutation({
    args: { ...common, to: scopeValidator },
    handler: async (ctx, args): Promise<ScopeMutationResult> => {
      await authorize(args)
      const { db, id, row } = await readableRow(ctx, args)
      const plan = await planMove(ctx, { kind, row, to: args.to, userId: args.userId })
      if (!plan.ok || !id) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
      await db.patch(id, plan.patch)
      const moved = [id]
      // A folder's contents go with it: only the creator's own, not-archived rows.
      for (const childId of (await options?.descendants?.(db, id)) ?? []) {
        const child = await db.get(childId)
        if (child && !child.archivedAt && child.userId === row?.userId) { await db.patch(childId, plan.patch); moved.push(childId) }
      }
      if (row) await options?.afterApply?.(ctx, { action: 'scope', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId, to: args.to, moved })
      return { ok: true }
    },
  })

  const archive = mutation({
    args: common,
    handler: async (ctx, args): Promise<ScopeMutationResult> => {
      await authorize(args)
      const { db, id, row } = await readableRow(ctx, args)
      const plan = await planArchive(ctx, { row, userId: args.userId, now: Date.now() })
      if (!plan.ok || !id) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
      await db.patch(id, { ...plan.patch, ...(options?.onArchive ?? {}) })
      for (const childId of (await options?.descendants?.(db, id)) ?? []) {
        const child = await db.get(childId)
        if (child && !child.archivedAt && child.userId === row?.userId) {
          await db.patch(childId, { archivedAt: plan.patch.archivedAt, archivedBy: plan.patch.archivedBy, archivedFromScope: rowScopeOf(child), ...(options?.onArchive ?? {}) })
        }
      }
      if (row) await options?.afterApply?.(ctx, { action: 'archived', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId })
      return { ok: true }
    },
  })

  const restore = mutation({
    args: common,
    handler: async (ctx, args): Promise<ScopeMutationResult> => {
      await authorize(args)
      const { db, id, row } = await readableRow(ctx, args)
      const plan = await planRestore(ctx, { row, userId: args.userId })
      if (!plan.ok || !id) return { ok: false, reason: plan.ok ? 'not_found' : plan.reason }
      const archivedAt = row?.archivedAt
      await db.patch(id, { scope: plan.scope, archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined })
      // Only the contents that were archived together with it come back.
      for (const childId of (await options?.descendants?.(db, id)) ?? []) {
        const child = await db.get(childId)
        if (child && child.archivedAt !== undefined && child.archivedAt === archivedAt) {
          await db.patch(childId, { scope: child.archivedFromScope ?? child.scope ?? 'personal', archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined })
        }
      }
      if (row) await options?.afterApply?.(ctx, { action: 'restored', id, row, userId: args.userId, actingAgentPrincipalId: args.actingAgentPrincipalId })
      return { ok: true }
    },
  })

  return { setScope, archive, restore }
}
