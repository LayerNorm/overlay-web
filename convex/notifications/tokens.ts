import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { nativeViewer } from '../lib/nativeViewer'

export const register = mutation({
  args: {
    expoToken: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) throw new Error('UNAUTHENTICATED')
    if (
      args.expoToken.length > 256 ||
      !/^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/.test(args.expoToken) ||
      !args.deviceId.trim() ||
      args.deviceId.length > 128
    )
      throw new Error('INVALID_PUSH_TOKEN')
    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('expoToken', args.expoToken))
      .unique()
    const updatedAt = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1)
    const devices = await ctx.db
      .query('pushTokens')
      .withIndex('by_user', (q) => q.eq('userId', viewer.userId))
      .collect()
    for (const row of devices) {
      if (
        row.deviceId === args.deviceId &&
        row.expoToken !== args.expoToken &&
        row.revokedAt === undefined
      )
        await ctx.db.patch(row._id, { revokedAt: updatedAt })
    }
    const value = { ...args, userId: viewer.userId, updatedAt, revokedAt: undefined }
    if (existing) {
      await ctx.db.patch(existing._id, value)
      return existing._id
    }
    return await ctx.db.insert('pushTokens', value)
  },
})

export const unregister = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) throw new Error('UNAUTHENTICATED')
    const rows = await ctx.db
      .query('pushTokens')
      .withIndex('by_user', (q) => q.eq('userId', viewer.userId))
      .collect()
    for (const row of rows)
      if (row.deviceId === args.deviceId && row.revokedAt === undefined)
        await ctx.db.patch(row._id, { revokedAt: Date.now() })
  },
})
