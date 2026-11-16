import assert from 'node:assert/strict'
import test from 'node:test'
import type { OverlayServerContext } from '@/server/bootstrap'
import { AccountDeletionService } from './AccountDeletionService'

function service(options: { providerRefs?: string[]; failOn?: string[] } = {}) {
  const deleted: string[] = []
  const ctx = {
    appData: { repositories: {
      providerConnections: { listCredentialRefs: async () => options.providerRefs ?? [] },
    } },
    byokCredentialStore: {
      delete: async (ref: string) => {
        if (options.failOn?.includes(ref)) throw new Error('vault unavailable')
        deleted.push(ref)
      },
    },
  } as unknown as OverlayServerContext
  const run = (userId = 'user-1') => (new AccountDeletionService(ctx, {
    revokeAllForUser: async () => {},
  }) as unknown as {
    deleteStoredCredentials(userId: string): Promise<void>
  }).deleteStoredCredentials(userId)
  return { run, deleted }
}

test('account deletion removes every stored model-provider credential once', async () => {
  const { run, deleted } = service({ providerRefs: ['key-1', 'key-2', 'key-2'] })
  await run()
  assert.deepEqual(deleted.sort(), ['key-1', 'key-2'], 'each distinct reference once')
})

test('a credential that cannot be deleted stops the deletion, so the secret is never orphaned', async () => {
  const { run, deleted } = service({ providerRefs: ['key-1', 'key-2', 'key-3'], failOn: ['key-2'] })
  await assert.rejects(run(), /Could not delete 1 stored credential\. Nothing else was deleted/)
  // The others were still attempted, so a retry has less to do.
  assert.deepEqual(deleted.sort(), ['key-1', 'key-3'])
})

test('a person with no stored credentials deletes cleanly', async () => {
  const { run, deleted } = service()
  await run()
  assert.deepEqual(deleted, [])
})

test('account deletion stops before row deletion when subscription vault cleanup fails', async () => {
  const ctx = {} as unknown as OverlayServerContext
  const deletion = new AccountDeletionService(ctx, {
    revokeAllForUser: async () => { throw new Error('vault unavailable') },
  }) as unknown as {
    deleteAccount(args: { userId: string }): Promise<unknown>
    deleteIntegrationConnectionsBestEffort(userId: string): Promise<void>
  }
  let integrationCleanupCalled = false
  deletion.deleteIntegrationConnectionsBestEffort = async () => {
    integrationCleanupCalled = true
  }

  await assert.rejects(
    deletion.deleteAccount({ userId: 'user-1' }),
    /Could not revoke subscription connections\. Nothing else was deleted/,
  )
  assert.equal(integrationCleanupCalled, false)
})
