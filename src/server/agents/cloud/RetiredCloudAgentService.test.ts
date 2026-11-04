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
      markReclaimPending: async () => true,
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

test('explicit teardown queues ready provision cleanup until its lease is released', async () => {
  let provision: Record<string, unknown> = {
    workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'ready',
    environmentId: 'cloud-env', provider: 'box', providerReference: 'provider-machine',
    allocationKey: 'allocation', createdAt: 1, updatedAt: 2,
  }
  const lease = {
    id: 'lease', workspaceId: 'workspace', environmentId: 'cloud-env',
    provider: 'box', providerReference: 'provider-machine', status: 'active' as 'active' | 'cleanup_failed' | 'released',
  }
  let environmentStatus = 'approved'
  let marked = 0
  let deletions = 0
  const audits: Array<{ metadata?: Record<string, unknown> }> = []
  const retirement = new RetiredCloudAgentService({
    audit: { record: async (entry: { metadata?: Record<string, unknown> }) => { audits.push(entry) } } as never,
    controlPlane: { revokeEnvironment: async () => { environmentStatus = 'revoked' } },
    repository: {
      listBindings: async () => [],
      getEnvironment: async () => ({ id: 'cloud-env', kind: 'overlay_cloud', status: environmentStatus }),
      getActiveSandboxLease: async () => lease.status === 'active' ? lease : null,
      listSandboxLeases: async ({ statuses }) => statuses.includes(lease.status) ? [lease] : [],
    } as never,
    provisions: {
      get: async () => ({ ...provision }),
      listReclaimable: async () => provision.reclaimPending ? [{ ...provision }] : [],
      claimReclaim: async () => null,
      markReclaimPending: async (args: { workspaceId: string; agentId: string; allocationKey: string; now: number }) => {
        assert.deepEqual(args, { workspaceId: 'workspace', agentId: 'agent', allocationKey: 'allocation', now })
        marked += 1
        provision = { ...provision, phase: 'failed', error: 'Hosted Cloud runtime retired; provider cleanup is pending.', reclaimPending: true, updatedAt: now }
        return true
      },
      finishReclaim: async (args: { workspaceId: string; agentId: string; allocationKey: string; providerReference: string; now: number }) => {
        assert.deepEqual(args, {
          workspaceId: 'workspace', agentId: 'agent', allocationKey: 'allocation',
          providerReference: 'provider-machine', now,
        })
        provision = {
          ...provision,
          provider: undefined,
          providerReference: undefined,
          allocationKey: undefined,
          allocatedAt: undefined,
          reclaimPending: undefined,
          updatedAt: now,
        }
        return true
      },
    } as never,
    runtime: () => ({
      reconnect: async (reference, options) => {
        assert.equal(reference, 'provider-machine')
        assert.equal(options?.resume, false)
        if (deletions > 0) throw new Error('404 sandbox not found')
        return {
          status: async () => 'stopped',
          delete: async () => { deletions += 1 },
        }
      },
    } as never),
    now: () => now,
  })

  assert.deepEqual(await retirement.teardown({
    actorUserId: 'owner', workspaceId: 'workspace', agentId: 'agent',
  }), { cleanupPending: 1 })
  assert.equal(marked, 1)
  assert.equal(provision.reclaimPending, true)
  assert.deepEqual(await retirement.reclaimAbandonedProvisions(), { reclaimed: 0, skipped: 1, failed: 0 })
  assert.equal(deletions, 0)

  lease.status = 'cleanup_failed'
  assert.equal((await retirement.status({ workspaceId: 'workspace', agentId: 'agent' })).machine?.state, 'stopped')
  assert.deepEqual(await retirement.reclaimAbandonedProvisions(), { reclaimed: 0, skipped: 1, failed: 0 })
  assert.equal(deletions, 0)

  lease.status = 'released'
  assert.deepEqual(await retirement.reclaimAbandonedProvisions(), { reclaimed: 1, skipped: 0, failed: 0 })
  assert.equal(deletions, 1)
  assert.equal(provision.providerReference, undefined)
  assert.equal(provision.allocationKey, undefined)
  assert.deepEqual(audits[0]?.metadata, {
    workspaceId: 'workspace',
    agentId: 'agent',
    provider: 'box',
    allocationKey: 'allocation',
    providerReference: 'provider-machine',
  })
  assert.deepEqual(await retirement.teardown({
    actorUserId: 'owner', workspaceId: 'workspace', agentId: 'agent',
  }), { cleanupPending: 0 })
})


test('a provider delete acknowledgement cannot finish cleanup while the machine still exists', async () => {
  const provision = {
    workspaceId: 'workspace', agentId: 'agent', userId: 'owner', phase: 'failed',
    provider: 'box', providerReference: 'orphan-machine', allocationKey: 'allocation',
    reclaimPending: true, createdAt: 1, updatedAt: 2,
  }
  let finishes = 0
  let deletes = 0
  let lookups = 0
  const retirement = new RetiredCloudAgentService({
    audit: { record: async () => undefined } as never,
    controlPlane: { revokeEnvironment: async () => undefined },
    repository: {
      listBindings: async () => [], getEnvironment: async () => null,
      getActiveSandboxLease: async () => null, listSandboxLeases: async () => [],
    } as never,
    provisions: {
      listReclaimable: async () => [provision],
      finishReclaim: async () => { finishes += 1; return true },
    } as never,
    runtime: () => ({
      reconnect: async (_reference: string, options?: { resume?: boolean }) => {
        assert.equal(options?.resume, false)
        lookups += 1
        return { delete: async () => { deletes += 1 } }
      },
    } as never),
    now: () => now,
  })
  assert.deepEqual(await retirement.reclaimAbandonedProvisions(), { reclaimed: 0, skipped: 0, failed: 1 })
  assert.equal(lookups, 2)
  assert.equal(deletes, 1)
  assert.equal(finishes, 0)
})
