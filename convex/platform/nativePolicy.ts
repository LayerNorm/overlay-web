import { v } from 'convex/values'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core'
import { internalAction, internalMutation, query } from '../_generated/server'
import { internal } from '../_generated/api'
import { fetchAppCallback } from '../lib/appCallback'
import { nativeViewer, requireNativeWorkspace } from '../lib/nativeViewer'
import { currentNativeDeploymentPolicy, nativePolicyFeatureEnabled, nativePolicySourceOrigin } from '../lib/nativeDeploymentPolicy'
import { nativePolicySnapshotValidator } from '../lib/nativePolicySchema'
import {
  NATIVE_POLICY_LEASE_MS,
  NATIVE_POLICY_RESPONSE_MAX_AGE_MS,
  NATIVE_POLICY_RESPONSE_MAX_BYTES,
  nativePolicyResponseSchema,
  nativePolicySnapshotSchema,
  type NativeDeploymentFeature,
} from '@/shared/authorization/native-deployment-policy'

export const beginRefresh = internalMutation({
  args: { challenge: v.string() },
  handler: async (ctx, { challenge }) => {
    const sourceOrigin = nativePolicySourceOrigin()
    const row = await ctx.db.query('nativeDeploymentPolicies').withIndex('by_key', q => q.eq('key', 'web')).unique()
    const sequence = (row?.sequence ?? 0) + 1
    if (row) await ctx.db.patch(row._id, { sequence, challenge, sourceOrigin,
      ...(row.sourceOrigin !== sourceOrigin ? { expiresAt: 0, snapshot: undefined } : {}) })
    else await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence, challenge, sourceOrigin, expiresAt: 0 })
    return { sequence, sourceOrigin }
  },
})

export const publish = internalMutation({
  args: { sequence: v.number(), challenge: v.string(), snapshot: nativePolicySnapshotValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('nativeDeploymentPolicies').withIndex('by_key', q => q.eq('key', 'web')).unique()
    if (!row || row.sequence !== args.sequence || row.challenge !== args.challenge) return false
    if (row.sourceOrigin !== nativePolicySourceOrigin() || args.snapshot.backendUrl !== process.env.CONVEX_CLOUD_URL) {
      throw new Error('NATIVE_POLICY_SOURCE_MISMATCH')
    }
    const snapshot = nativePolicySnapshotSchema.parse(args.snapshot)
    const expiresAt = Date.now() + NATIVE_POLICY_LEASE_MS
    await ctx.db.patch(row._id, { snapshot, expiresAt, challenge: '' })
    await ctx.scheduler.runAt(expiresAt, internal.platform.nativePolicy.expire, { expiresAt })
    return true
  },
})

export const invalidate = internalMutation({
  args: { sequence: v.number() },
  handler: async (ctx, { sequence }) => {
    const row = await ctx.db.query('nativeDeploymentPolicies').withIndex('by_key', q => q.eq('key', 'web')).unique()
    if (row?.sequence === sequence) await ctx.db.patch(row._id, { expiresAt: 0, snapshot: undefined })
  },
})

export const expire = internalMutation({
  args: { expiresAt: v.number() },
  handler: async (ctx, { expiresAt }) => {
    const row = await ctx.db.query('nativeDeploymentPolicies').withIndex('by_key', q => q.eq('key', 'web')).unique()
    // A refresh in progress must not prevent the preceding lease from expiring.
    if (row?.expiresAt === expiresAt && expiresAt <= Date.now()) {
      await ctx.db.patch(row._id, { expiresAt: 0, snapshot: undefined })
    }
  },
})

export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const challenge = crypto.randomUUID()
    let sequence: number | undefined
    try {
      const started = await ctx.runMutation(internal.platform.nativePolicy.beginRefresh, { challenge })
      sequence = started.sequence
      const secret = process.env.INTERNAL_API_SECRET?.trim()
      if (!secret) throw new Error('NATIVE_POLICY_AUTH_UNAVAILABLE')
      const response = await fetchAppCallback(`${started.sourceOrigin}/api/auth/convex-policy?challenge=${challenge}`, {
        headers: { 'x-internal-api-secret': secret },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('NATIVE_POLICY_FETCH_FAILED')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('NATIVE_POLICY_RESPONSE_INVALID')
      let size = 0
      const chunks: Uint8Array[] = []
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > NATIVE_POLICY_RESPONSE_MAX_BYTES) throw new Error('NATIVE_POLICY_RESPONSE_TOO_LARGE')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const result = nativePolicyResponseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
      if (result.challenge !== challenge || Math.abs(Date.now() - result.issuedAt) > NATIVE_POLICY_RESPONSE_MAX_AGE_MS) {
        throw new Error('NATIVE_POLICY_RESPONSE_STALE')
      }
      await ctx.runMutation(internal.platform.nativePolicy.publish, { sequence: started.sequence, challenge, snapshot: result.snapshot })
    } catch {
      if (sequence !== undefined) await ctx.runMutation(internal.platform.nativePolicy.invalidate, { sequence })
      console.warn('[native-policy] refresh unavailable; native deployment-gated features fail closed')
    }
    return null
  },
})

export const status = query({
  args: { workspaceId: v.optional(v.string()) },
  handler: async (ctx, { workspaceId }) => {
    if (!await nativeViewer(ctx)) throw new Error('UNAUTHENTICATED')
    if (workspaceId) await requireNativeWorkspace(ctx, workspaceId)
    const policy = await currentNativeDeploymentPolicy(ctx)
    const features = Object.fromEntries(
      [...Object.keys(DEFAULT_OVERLAY_CAPABILITIES), 'workspaceHandles'].map(feature => [
        feature, nativePolicyFeatureEnabled(policy, feature as NativeDeploymentFeature, workspaceId),
      ]),
    )
    return { ready: policy !== null, features }
  },
})
