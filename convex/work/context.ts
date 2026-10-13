import { v } from 'convex/values'
import { query } from '../_generated/server'
import { workAuth, workScope, contextRef } from './validators'
import { authorize } from './rules'
import { listScopedRows } from '../lib/resourceScope'
export const list = query({
  args: { ...workAuth, scope: workScope }, returns: v.array(contextRef),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const files = await listScopedRows(ctx, { userId: args.userId, workspaceId: args.workspaceId, view: args.scope,
      fetchMine: () => ctx.db.query('files').withIndex('by_userId', (q) => q.eq('userId', args.userId)).take(100),
      fetchShared: (ws) => ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).take(100),
    })
    const chats = args.scope === 'personal' ? await ctx.db.query('conversations').withIndex('by_userId', (q) => q.eq('userId', args.userId)).order('desc').take(100) : []
    return [
      ...files.filter((file) => file.type !== 'folder').map((file) => ({ type: file.kind === 'note' ? 'note' as const : 'file' as const, id: file._id, label: file.name })),
      ...chats.filter((chat) => chat.workspaceId === args.workspaceId && !chat.deletedAt && (!chat.conversationType || chat.conversationType === 'personal')).map((chat) => ({ type: 'chat' as const, id: chat._id, label: chat.title })),
    ]
  },
})
