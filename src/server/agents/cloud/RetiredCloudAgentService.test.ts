import assert from 'node:assert/strict'
import test from 'node:test'
import { RetiredCloudAgentService } from './RetiredCloudAgentService'

const now = 10

function service(provision: Record<string, unknown>, lease: Record<string, unknown> | null) {
  const environment = provision.environmentId
    ? { id: provision.environmentId, kind: 'overlay_cloud', status: 'approved' }
    : null
  return new RetiredCloudAgentService({
    audit: { record: async () => undefined } as never,
    controlPlane: { revokeEnvironment: async () => undefined },
    repository: {
      listBindings: async () => [],
      getEnvironment: async () => environment,
      getActiveSandboxLease: async () => null,
      listSandboxLeases: async () => lease ? [lease] : [],
    } as never,
    provisions: {
      get: async () => provision,
      listReclaimable: async () => [],
      claimReclaim: async () => null,
      finishReclaim: async () => false,
    } as never,
    now: () => now,
  })
}

test('teardown reports a cleanup_failed lease as pending', async () => {
  const result = await service(
    {
      workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'failed',
      environmentId: 'cloud-env', provider: 'box', providerReference: 'provider-machine',
      allocationKey: 'allocation', createdAt: 1, updatedAt: 2,
    },
    {
      id: 'lease', workspaceId: 'workspace', environmentId: 'cloud-env',
      provider: 'box', providerReference: 'provider-machine', status: 'cleanup_failed',
    },
  ).teardown({ actorUserId: 'owner', workspaceId: 'workspace', agentId: 'agent' })

  assert.deepEqual(result, { cleanupPending: 1 })
})

test('teardown does not claim an orphan provider reference was deleted', async () => {
  const result = await service(
    {
      workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'failed',
      provider: 'box', providerReference: 'orphan-machine', allocationKey: 'allocation',
      createdAt: 1, updatedAt: 2,
    },
    null,
  ).teardown({ actorUserId: 'owner', workspaceId: 'workspace', agentId: 'agent' })

  assert.deepEqual(result, { cleanupPending: 1 })
})

test('teardown keeps a provision-only allocation pending without a provider reference', async () => {
  const result = await service(
    {
      workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'provisioning',
      allocationKey: 'allocation', createdAt: 1, updatedAt: 2,
    },
    null,
  ).teardown({ actorUserId: 'owner', workspaceId: 'workspace', agentId: 'agent' })

  assert.deepEqual(result, { cleanupPending: 1 })
})

test('failed provider deletion stays retryable and never resumes or finishes the allocation', async () => {
  const provision = {
    workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'failed',
    provider: 'box', providerReference: 'orphan-machine', allocationKey: 'allocation',
    reclaimPending: true, createdAt: 1, updatedAt: 2,
  }
  let deletes = 0
  let finishes = 0
  const service = new RetiredCloudAgentService({
    audit: { record: async () => undefined } as never,
    controlPlane: { revokeEnvironment: async () => undefined },
    repository: {
      listBindings: async () => [],
      getEnvironment: async () => null,
      getActiveSandboxLease: async () => null,
      listSandboxLeases: async () => [],
    } as never,
    provisions: {
      get: async () => provision,
      listReclaimable: async () => [provision],
      claimReclaim: async () => null,
      finishReclaim: async () => { finishes += 1; return true },
    } as never,
    runtime: () => ({
      reconnect: async (_reference, options) => {
        assert.equal(options?.resume, false)
        return { delete: async () => { deletes += 1; throw new Error('provider unavailable') } }
      },
    } as never),
    now: () => now,
  })

  assert.deepEqual(await service.reclaimAbandonedProvisions(), { reclaimed: 0, skipped: 0, failed: 1 })
  assert.deepEqual(await service.reclaimAbandonedProvisions(), { reclaimed: 0, skipped: 0, failed: 1 })
  assert.equal(deletes, 2)
  assert.equal(finishes, 0)
})
