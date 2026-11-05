import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { requireNativeCapability } from './lib/nativeCapabilities'
import { nativeDeploymentFeatureEnabled } from './lib/nativeDeploymentPolicy'
import { NATIVE_POLICY_LEASE_MS } from '@/shared/authorization/native-deployment-policy'

const modules = import.meta.glob('./**/*.ts')
const begin = makeFunctionReference<'mutation'>('platform/nativePolicy:beginRefresh')
const publish = makeFunctionReference<'mutation'>('platform/nativePolicy:publish')
const invalidate = makeFunctionReference<'mutation'>('platform/nativePolicy:invalidate')
const expire = makeFunctionReference<'mutation'>('platform/nativePolicy:expire')
const status = makeFunctionReference<'query'>('platform/nativePolicy:status')
const refresh = makeFunctionReference<'action'>('platform/nativePolicy:refresh')
const challenge = '00000000-0000-4000-8000-000000000001'
const backendUrl = 'https://fixture.convex.cloud'
const snapshot = {
  version: 1 as const, backendUrl, revision: 'a'.repeat(64),
  features: { files: true, skills: true, mcpServers: true, externalAgents: true, connectedAgents: true, workspaceHandles: false },
  rollout: { stage: 'invited' as const, internalWorkspaceIds: 'internal', invitedWorkspaceIds: 'invited' },
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers() })

async function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  vi.stubEnv('INTERNAL_API_SECRET', 'fixture-service-secret')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', { roleId: 'member', name: 'Member', capabilities: ['files.read', 'conversations.read'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'u', createdAt: 1 })
  })
  return t
}

test('mapped features fail closed without a fresh policy while unmapped chat remains authorized', async () => {
  const t = await fixture()
  await expect(t.run(ctx => requireNativeCapability(ctx, 'u', 'files.read'))).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  await t.run(ctx => requireNativeCapability(ctx, 'u', 'conversations.read'))
  const { sequence } = await t.mutation(begin, { challenge })
  await t.mutation(publish, { sequence, challenge, snapshot })
  await t.run(ctx => requireNativeCapability(ctx, 'u', 'files.read'))
  await expect(t.run(ctx => requireNativeCapability(ctx, 'other', 'files.read'))).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  vi.setSystemTime(Date.now() + NATIVE_POLICY_LEASE_MS + 1)
  await expect(t.run(ctx => requireNativeCapability(ctx, 'u', 'files.read'))).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
})

test('latest refresh wins, replay cannot extend a lease, and old failure cannot invalidate a newer publication', async () => {
  const t = await fixture()
  const first = await t.mutation(begin, { challenge })
  const second = await t.mutation(begin, { challenge: '00000000-0000-4000-8000-000000000002' })
  expect(await t.mutation(publish, { sequence: first.sequence, challenge, snapshot })).toBe(false)
  const secondArgs = { sequence: second.sequence, challenge: '00000000-0000-4000-8000-000000000002', snapshot }
  expect(await t.mutation(publish, secondArgs)).toBe(true)
  expect(await t.mutation(publish, secondArgs)).toBe(false)
  await t.mutation(invalidate, { sequence: first.sequence })
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(true)
  await t.mutation(invalidate, { sequence: second.sequence })
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(false)
})

test('old expiry preserves a renewed lease but a hung refresh does not preserve an expired lease', async () => {
  const t = await fixture()
  const first = await t.mutation(begin, { challenge })
  await t.mutation(publish, { sequence: first.sequence, challenge, snapshot })
  const firstExpiry = Date.now() + NATIVE_POLICY_LEASE_MS
  vi.setSystemTime(Date.now() + 1000)
  const second = await t.mutation(begin, { challenge })
  await t.mutation(publish, { sequence: second.sequence, challenge, snapshot })
  await t.mutation(expire, { expiresAt: firstExpiry })
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(true)
  await t.mutation(begin, { challenge })
  vi.setSystemTime(firstExpiry + 1000)
  await t.mutation(expire, { expiresAt: firstExpiry + 1000 })
  const row = await t.run(ctx => ctx.db.query('nativeDeploymentPolicies').first())
  expect(row?.snapshot).toBeUndefined()
})

test('backend/source binding, disabled flags, workspace rollout and redaction remain enforced', async () => {
  const t = await fixture()
  const { sequence } = await t.mutation(begin, { challenge })
  await expect(t.mutation(publish, { sequence, challenge, snapshot: { ...snapshot, backendUrl: 'https://wrong.convex.cloud' } })).rejects.toThrow('NATIVE_POLICY_SOURCE_MISMATCH')
  await t.mutation(publish, { sequence, challenge, snapshot: { ...snapshot, features: { ...snapshot.features, skills: false } } })
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'skills'))).toBe(false)
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'externalAgents', 'invited'))).toBe(true)
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'externalAgents', 'other'))).toBe(false)
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'externalAgents'))).toBe(false)
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'connectedAgents', 'invited'))).toBe(true)
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'connectedAgents', 'other'))).toBe(false)
  await expect(t.query(status, {})).rejects.toThrow('UNAUTHENTICATED')
  const result = await t.withIdentity({ subject: 'u' }).query(status, {})
  expect(Object.keys(result).sort()).toEqual(['features', 'ready'])
  expect(JSON.stringify(result)).not.toContain('invited')
  expect(JSON.stringify(result)).not.toContain(backendUrl)
  await expect(t.withIdentity({ subject: 'u' }).query(status, { workspaceId: 'other' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  vi.stubEnv('OVERLAY_BFF_URL', 'https://new.example.test')
  expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(false)
})

test('refresh binds service authentication, challenge, backend and freshness; failures revoke the lease', async () => {
  const t = await fixture()
  let failure: 'none' | 'nonce' | 'backend' | 'stale' | 'unavailable' = 'none'
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe('https://app.example.test')
    expect(new Headers(init.headers).get('x-internal-api-secret')).toBe('fixture-service-secret')
    expect(init.redirect).toBe('error')
    if (failure === 'unavailable') return new Response(null, { status: 503 })
    return Response.json({
      challenge: failure === 'nonce' ? challenge : new URL(url).searchParams.get('challenge'),
      issuedAt: Date.now() - (failure === 'stale' ? 60_000 : 0),
      snapshot: { ...snapshot, backendUrl: failure === 'backend' ? 'https://wrong.convex.cloud' : backendUrl },
    })
  })
  for (const rejection of ['nonce', 'backend', 'stale', 'unavailable'] as const) {
    failure = 'none'
    await t.action(refresh, {})
    expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(true)
    failure = rejection
    await t.action(refresh, {})
    expect(await t.run(ctx => nativeDeploymentFeatureEnabled(ctx, 'files'))).toBe(false)
  }
})
