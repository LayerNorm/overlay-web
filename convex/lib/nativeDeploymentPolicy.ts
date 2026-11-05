import type { QueryCtx } from '../_generated/server'
import type { NativeDeploymentFeature, NativePolicySnapshot } from '@/shared/authorization/native-deployment-policy'
import { resolveConnectedAgentRollout } from '@/shared/agents/connected-agent-rollout'

export function nativePolicySourceOrigin(): string {
  const configured = process.env.OVERLAY_BFF_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configured) throw new Error('NATIVE_POLICY_SOURCE_UNAVAILABLE')
  const url = new URL(configured)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('NATIVE_POLICY_SOURCE_INVALID')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && process.env.OVERLAY_DEPLOYMENT_ENV === 'development')) {
    throw new Error('NATIVE_POLICY_SOURCE_INVALID')
  }
  return url.origin
}

export async function currentNativeDeploymentPolicy(ctx: Pick<QueryCtx, 'db'>): Promise<NativePolicySnapshot | null> {
  let sourceOrigin: string
  try { sourceOrigin = nativePolicySourceOrigin() } catch { return null }
  const policy = await ctx.db.query('nativeDeploymentPolicies').withIndex('by_key', q => q.eq('key', 'web')).unique()
  if (!policy?.snapshot || policy.expiresAt <= Date.now() || policy.sourceOrigin !== sourceOrigin
    || policy.snapshot.backendUrl !== process.env.CONVEX_CLOUD_URL) return null
  return policy.snapshot
}

export function nativePolicyFeatureEnabled(
  policy: NativePolicySnapshot | null,
  feature: NativeDeploymentFeature,
  workspaceId?: string,
): boolean {
  if (policy?.features[feature] !== true) return false
  return (feature !== 'externalAgents' && feature !== 'connectedAgents')
    || resolveConnectedAgentRollout(policy.rollout, workspaceId).eligible
}

export async function nativeDeploymentFeatureEnabled(
  ctx: Pick<QueryCtx, 'db'>,
  feature: NativeDeploymentFeature,
  workspaceId?: string,
): Promise<boolean> {
  return nativePolicyFeatureEnabled(await currentNativeDeploymentPolicy(ctx), feature, workspaceId)
}

export async function requireNativeDeploymentFeature(
  ctx: Pick<QueryCtx, 'db'>,
  feature: NativeDeploymentFeature,
  workspaceId?: string,
): Promise<void> {
  if (!await nativeDeploymentFeatureEnabled(ctx, feature, workspaceId)) throw new Error('DEPLOYMENT_FEATURE_ACCESS_DENIED')
}
