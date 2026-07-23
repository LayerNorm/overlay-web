import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthorizationCapability, AuthorizationSubject } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization'
import type { DurableJob } from './DurableJobRepository'
import { authorizeDurableJob, durableJobAuthorization } from './DurableJobAuthorization'

test('durable job authorization re-checks capabilities at execution time', async () => {
  const capabilities = new Set<AuthorizationCapability>(['automations.use', 'models.use'])
  const authorization = fakeAuthorization(capabilities)
  const job = durableJob({
    runId: 'run_1',
    ...durableJobAuthorization('user_1', ['automations.use', 'models.use']),
  })

  assert.equal((await authorizeDurableJob({ authorization, job })).allowed, true)
  capabilities.delete('automations.use')
  assert.deepEqual(await authorizeDurableJob({ authorization, job }), {
    actorUserId: 'user_1',
    allowed: false,
    deniedCapabilities: ['automations.use'],
    reason: 'authorization_revoked',
  })
})

test('durable jobs without actor metadata fail closed when authorization is enabled', async () => {
  const result = await authorizeDurableJob({
    authorization: fakeAuthorization(new Set()),
    job: durableJob({ runId: 'legacy_run' }),
  })
  assert.deepEqual(result, {
    allowed: false,
    deniedCapabilities: [],
    reason: 'authorization_metadata_missing',
  })
})

function fakeAuthorization(capabilities: Set<AuthorizationCapability>): AuthorizationService {
  return {
    async resolveSubject(userId: string): Promise<AuthorizationSubject> {
      return {
        capabilities: [...capabilities],
        groupIds: [],
        isDeploymentOwner: false,
        roleIds: [],
        userId,
      }
    },
    checkResolvedCapability(subject: AuthorizationSubject, capability: AuthorizationCapability) {
      return {
        allowed: subject.capabilities.includes(capability),
        capability,
        reason: subject.capabilities.includes(capability)
          ? 'resource_access_granted' as const
          : 'capability_missing' as const,
      }
    },
  } as unknown as AuthorizationService
}

function durableJob(payload: Record<string, unknown>): DurableJob {
  return {
    attempts: 1,
    availableAt: 1,
    id: 'job_1',
    maxAttempts: 5,
    payload,
    priority: 10,
    status: 'running',
    type: 'automation.execute',
  }
}
