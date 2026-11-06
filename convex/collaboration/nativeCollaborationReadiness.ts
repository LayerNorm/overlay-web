import type { QueryCtx } from '../_generated/server'

export const NATIVE_COLLABORATION_FUNCTIONS_READY = false
export const NATIVE_ROOM_RECENCY_MIGRATION = 'native-room-recency-v1'

export async function nativeCollaborationMetadata(
  ctx: Pick<QueryCtx, 'db'>,
  functionsReady = NATIVE_COLLABORATION_FUNCTIONS_READY,
): Promise<{ nativeCollaborationRevision?: 'native-collaboration-v1' }> {
  if (!functionsReady) return {}
  const state = await ctx.db.query('migrationMarkers')
    .withIndex('by_key_scope', q => q.eq('key', NATIVE_ROOM_RECENCY_MIGRATION).eq('scope', 'global')).unique()
  return state && state.completedAt > 0 ? { nativeCollaborationRevision: 'native-collaboration-v1' } : {}
}
